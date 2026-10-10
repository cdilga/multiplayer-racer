//! The generator's tunable values as versioned data (br-2sdu.3, R125): `assets/profiles/generator.json`.
//!
//! The owner tuning menu edits these and the export patches that file. They are the numbers the generator reads: the
//! course's length band and straights, each biome's terrain (relief, grade, curvature, bank, wavelength, blend) and
//! feature densities, and the recipe (the biome mix). The shipped file equals the constants and biome definitions the
//! generator had before it existed (a test pins that, so the goldens did not move); a committed tuning changes the
//! file, the goldens and `GENERATOR_VERSION` together.

use std::sync::OnceLock;

use jj_map::Biome;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::features::Density;
use crate::terrain::TerrainParams;

/// The contract name inside the file.
pub const VERSION: u32 = 1;
const SHIPPED: &str = include_str!("../../../../assets/profiles/generator.json");

/// The course designer's numbers (metres).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CourseData {
    /// The lap length band a drawn course must fall inside.
    pub length_min_m: f64,
    pub length_max_m: f64,
    pub start_straight_min_m: f64,
    pub start_straight_max_m: f64,
    pub straight_min_m: f64,
    pub straight_max_m: f64,
    /// The shortest straight the loop-closing adjustment may leave.
    pub min_straight_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerrainData {
    pub relief_m: f64,
    pub ground_relief_m: f64,
    pub wavelength_m: f64,
    pub max_grade: f64,
    pub max_curvature: f64,
    pub max_bank_cdeg: i16,
    pub blend_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureData {
    pub jump: f64,
    pub crest: f64,
    pub whoops: f64,
    pub creek: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BiomeTuning {
    pub terrain: TerrainData,
    pub features: FeatureData,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Biomes {
    pub greybox: BiomeTuning,
    pub town: BiomeTuning,
    pub rocks: BiomeTuning,
    pub outback_dirt: BiomeTuning,
    pub outback_bitumen: BiomeTuning,
}

/// The whole file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneratorData {
    pub version: u32,
    pub what: String,
    /// The biome mix: comma-separated biome names in lap order (as `jj-wasm-procgen` takes them).
    pub recipe: String,
    pub course: CourseData,
    pub biomes: Biomes,
}

/// Why a document or a change was refused: one line per problem.
#[derive(Clone, Debug, PartialEq)]
pub struct GeneratorError(pub Vec<String>);

impl std::fmt::Display for GeneratorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0.join("; "))
    }
}

impl std::error::Error for GeneratorError {}

fn err(m: impl Into<String>) -> GeneratorError {
    GeneratorError(vec![m.into()])
}

impl GeneratorData {
    /// The file that ships (`assets/profiles/generator.json`), parsed once.
    pub fn shipped() -> &'static GeneratorData {
        static DATA: OnceLock<GeneratorData> = OnceLock::new();
        DATA.get_or_init(|| {
            Self::from_json(SHIPPED)
                .expect("assets/profiles/generator.json is valid (a test checks)")
        })
    }

    /// Parses and validates a generator document.
    pub fn from_json(text: &str) -> Result<Self, GeneratorError> {
        let d: Self = serde_json::from_str(text).map_err(|e| err(e.to_string()))?;
        d.validate()?;
        Ok(d)
    }

    /// The same document with each `(dotted path, json value)` set (`course.lengthMinM`, `biomes.town.terrain.reliefM`,
    /// `recipe`). Refuses an unknown path, a value of the wrong type or one the validator rejects; the original is
    /// untouched.
    pub fn with_fields(&self, set: &[(String, String)]) -> Result<Self, GeneratorError> {
        let mut v = serde_json::to_value(self).map_err(|e| err(e.to_string()))?;
        for (path, raw) in set {
            let value: Value =
                serde_json::from_str(raw).map_err(|e| err(format!("{path}: {e}")))?;
            let mut slot = &mut v;
            for part in path.split('.') {
                slot = slot
                    .get_mut(part)
                    .ok_or_else(|| err(format!("no generator field {path:?}")))?;
            }
            if slot.is_object() || path == "version" {
                return Err(err(format!("{path}: not a tunable value")));
            }
            *slot = value;
        }
        let d: Self =
            serde_json::from_value(v).map_err(|e| err(e.to_string().replace('\n', " ")))?;
        d.validate()?;
        Ok(d)
    }

    /// The checks every generator document passes before the generator reads it.
    pub fn validate(&self) -> Result<(), GeneratorError> {
        let mut bad = Vec::new();
        if self.version != VERSION {
            bad.push(format!("version {} (expected {VERSION})", self.version));
        }
        if let Err(e) = self.recipe_biomes() {
            bad.push(e);
        }
        let c = &self.course;
        let pos = |name: &str, v: f64, bad: &mut Vec<String>| {
            if !(v > 0.0 && v.is_finite()) {
                bad.push(format!("{name} = {v}: must be positive"));
            }
        };
        for (name, lo, hi) in [
            ("course.length", c.length_min_m, c.length_max_m),
            (
                "course.startStraight",
                c.start_straight_min_m,
                c.start_straight_max_m,
            ),
            ("course.straight", c.straight_min_m, c.straight_max_m),
        ] {
            pos(&format!("{name}MinM"), lo, &mut bad);
            pos(&format!("{name}MaxM"), hi, &mut bad);
            if lo > hi {
                bad.push(format!("{name}MinM {lo} is above {name}MaxM {hi}"));
            }
        }
        pos("course.minStraightM", c.min_straight_m, &mut bad);
        if c.length_max_m > 20_000.0 {
            bad.push("course.lengthMaxM: above 20 km".to_owned());
        }
        for (id, b) in self.biomes.all() {
            let t = &b.terrain;
            for (n, v) in [
                ("reliefM", t.relief_m),
                ("wavelengthM", t.wavelength_m),
                ("maxGrade", t.max_grade),
                ("maxCurvature", t.max_curvature),
                ("blendM", t.blend_m),
            ] {
                pos(&format!("biomes.{id}.terrain.{n}"), v, &mut bad);
            }
            if t.ground_relief_m < 0.0 || !t.ground_relief_m.is_finite() {
                bad.push(format!(
                    "biomes.{id}.terrain.groundReliefM: must not be negative"
                ));
            }
            if t.max_grade > 0.5 {
                bad.push(format!("biomes.{id}.terrain.maxGrade: above 0.5 (a wall)"));
            }
            if !(0..=4500).contains(&t.max_bank_cdeg) {
                bad.push(format!("biomes.{id}.terrain.maxBankCdeg: outside 0..4500"));
            }
            let f = &b.features;
            for (n, v) in [
                ("jump", f.jump),
                ("crest", f.crest),
                ("whoops", f.whoops),
                ("creek", f.creek),
            ] {
                if v < 0.0 || !v.is_finite() {
                    bad.push(format!("biomes.{id}.features.{n}: must not be negative"));
                }
            }
        }
        if bad.is_empty() {
            Ok(())
        } else {
            Err(GeneratorError(bad))
        }
    }

    /// The recipe's biomes in lap order.
    pub fn recipe_biomes(&self) -> Result<Vec<Biome>, String> {
        let list: Result<Vec<Biome>, String> = self
            .recipe
            .split(',')
            .map(|n| {
                serde_json::from_value(Value::String(n.trim().into()))
                    .map_err(|_| format!("recipe: unknown biome {:?}", n.trim()))
            })
            .collect();
        let list = list?;
        if list.is_empty() {
            Err("recipe: empty".into())
        } else {
            Ok(list)
        }
    }

    /// The terrain numbers the generator uses for `biome`.
    pub fn terrain(&self, biome: Biome) -> TerrainParams {
        let t = self.biomes.get(biome).terrain;
        TerrainParams {
            relief_m: t.relief_m,
            ground_relief_m: t.ground_relief_m,
            wavelength_m: t.wavelength_m,
            max_grade: t.max_grade,
            max_curvature: t.max_curvature,
            max_bank_cdeg: t.max_bank_cdeg,
            blend_m: t.blend_m,
        }
    }

    /// The feature mix the generator uses for `biome`.
    pub fn density(&self, biome: Biome) -> Density {
        let f = self.biomes.get(biome).features;
        Density {
            jump: f.jump,
            crest: f.crest,
            whoops: f.whoops,
            creek: f.creek,
        }
    }

    /// The data the generator had before this file existed: the course constants and each biome's definition.
    pub fn builtin() -> Self {
        use crate::course::{LENGTH_BAND_M, MIN_STRAIGHT_M, START_STRAIGHT_M, STRAIGHT_M};
        let tuning = |b: Biome| {
            let d = crate::biome::def(b).data();
            BiomeTuning {
                terrain: TerrainData {
                    relief_m: d.terrain.relief_m,
                    ground_relief_m: d.terrain.ground_relief_m,
                    wavelength_m: d.terrain.wavelength_m,
                    max_grade: d.terrain.max_grade,
                    max_curvature: d.terrain.max_curvature,
                    max_bank_cdeg: d.terrain.max_bank_cdeg,
                    blend_m: d.terrain.blend_m,
                },
                features: FeatureData {
                    jump: d.features.jump,
                    crest: d.features.crest,
                    whoops: d.features.whoops,
                    creek: d.features.creek,
                },
            }
        };
        Self {
            version: VERSION,
            what: String::new(),
            recipe: crate::playtest::RECIPE_NAMES.to_owned(),
            course: CourseData {
                length_min_m: LENGTH_BAND_M.0,
                length_max_m: LENGTH_BAND_M.1,
                start_straight_min_m: START_STRAIGHT_M.0,
                start_straight_max_m: START_STRAIGHT_M.1,
                straight_min_m: STRAIGHT_M.0,
                straight_max_m: STRAIGHT_M.1,
                min_straight_m: MIN_STRAIGHT_M,
            },
            biomes: Biomes {
                greybox: tuning(Biome::Greybox),
                town: tuning(Biome::Town),
                rocks: tuning(Biome::Rocks),
                outback_dirt: tuning(Biome::OutbackDirt),
                outback_bitumen: tuning(Biome::OutbackBitumen),
            },
        }
    }
}

impl Biomes {
    fn get(&self, b: Biome) -> &BiomeTuning {
        match b {
            Biome::Greybox => &self.greybox,
            Biome::Town => &self.town,
            Biome::Rocks => &self.rocks,
            Biome::OutbackDirt => &self.outback_dirt,
            Biome::OutbackBitumen => &self.outback_bitumen,
        }
    }

    fn all(&self) -> [(&'static str, &BiomeTuning); 5] {
        [
            ("greybox", &self.greybox),
            ("town", &self.town),
            ("rocks", &self.rocks),
            ("outbackDirt", &self.outback_dirt),
            ("outbackBitumen", &self.outback_bitumen),
        ]
    }
}

impl Default for CourseData {
    fn default() -> Self {
        GeneratorData::shipped().course
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_file_is_the_generators_old_constants_so_nothing_moved() {
        let mut built = GeneratorData::builtin();
        built.what = GeneratorData::shipped().what.clone();
        assert_eq!(&built, GeneratorData::shipped());
    }

    /// `cargo test -p jj-procgen print_builtin -- --ignored --nocapture` prints the file to bless from the constants.
    #[test]
    #[ignore]
    fn print_builtin() {
        let mut b = GeneratorData::builtin();
        b.what = "Generator data (R125): the course length band and straights, each biome's terrain and feature mix, and the biome mix (recipe). Tuned in the owner tuning menu and changed here, never in code; jj-procgen validates the file at load. A committed change moves the goldens: bump GENERATOR_VERSION and re-bless tests/goldens.".into();
        println!("{}", serde_json::to_string_pretty(&b).unwrap());
    }

    #[test]
    fn a_change_applies_whole_or_not_at_all() {
        let d = GeneratorData::shipped();
        let ok = d
            .with_fields(&[
                ("course.lengthMinM".into(), "800".into()),
                ("biomes.town.terrain.reliefM".into(), "9.5".into()),
                ("recipe".into(), "\"town,rocks\"".into()),
            ])
            .unwrap();
        assert_eq!(ok.course.length_min_m, 800.0);
        assert_eq!(ok.biomes.town.terrain.relief_m, 9.5);
        assert_eq!(ok.recipe_biomes().unwrap().len(), 2);
        for (path, raw) in [
            ("course.lengthMinM", "5000"),
            ("course.lengthMinM", "-1"),
            ("course.lengthMinM", "\"long\""),
            ("course.nope", "1"),
            ("course", "1"),
            ("version", "2"),
            ("recipe", "\"town,nowhere\""),
            ("biomes.rocks.terrain.maxGrade", "0.9"),
            ("biomes.rocks.features.jump", "-1"),
        ] {
            let e = d.with_fields(&[(path.into(), raw.into())]);
            assert!(e.is_err(), "{path}={raw} should be refused");
        }
    }

    #[test]
    fn the_validator_names_each_problem() {
        let mut d = GeneratorData::shipped().clone();
        d.course.straight_max_m = 1.0;
        d.biomes.town.features.creek = -2.0;
        let GeneratorError(lines) = d.validate().unwrap_err();
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(GeneratorData::from_json("{}").is_err());
    }
}
