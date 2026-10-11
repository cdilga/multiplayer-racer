//! The generator's tunable values as versioned data (br-2sdu.3, R125): `assets/profiles/generator.json`.
//!
//! The owner tuning menu edits these and the export patches that file. They are the numbers the generator reads: the
//! course's length classes (sprint, standard, epic: weight, length band, laps) and straights, each biome's terrain
//! (relief, grade, curvature, bank, wavelength, blend) and feature densities, and the biome mix (weights for one to
//! four biomes per track). A committed tuning changes the file, the goldens and `GENERATOR_VERSION` together.

use std::sync::OnceLock;

use jj_map::Biome;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::features::Density;
use crate::terrain::TerrainParams;

/// The contract name inside the file.
pub const VERSION: u32 = 1;
const SHIPPED: &str = include_str!("../../../../assets/profiles/generator.json");

/// One length class (R125): how often it is drawn, the lap length band its courses are built to, and the laps a race
/// on such a track runs by default (the host may override them).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LengthClass {
    /// Relative weight (a share of seeds when the weights sum to 100).
    pub weight: f64,
    pub length_min_m: f64,
    pub length_max_m: f64,
    pub laps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LengthClasses {
    pub sprint: LengthClass,
    pub standard: LengthClass,
    pub epic: LengthClass,
}

/// The name of a length class.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ClassName {
    Sprint,
    Standard,
    Epic,
}

impl ClassName {
    pub const ALL: [ClassName; 3] = [ClassName::Sprint, ClassName::Standard, ClassName::Epic];

    pub fn name(self) -> &'static str {
        match self {
            ClassName::Sprint => "sprint",
            ClassName::Standard => "standard",
            ClassName::Epic => "epic",
        }
    }
}

impl LengthClasses {
    pub fn get(&self, c: ClassName) -> &LengthClass {
        match c {
            ClassName::Sprint => &self.sprint,
            ClassName::Standard => &self.standard,
            ClassName::Epic => &self.epic,
        }
    }
}

/// The course designer's numbers (metres).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CourseData {
    /// The length classes: one is drawn per seed by weight, and the course is built to its band.
    pub classes: LengthClasses,
    pub start_straight_min_m: f64,
    pub start_straight_max_m: f64,
    /// How uneven the straights are, 0 (all equal) to 1: each straight's share of the lap is drawn from 1 +/- this.
    pub straight_spread: f64,
    /// The shortest straight the course may leave.
    pub min_straight_m: f64,
    /// One extra left-right bend pair per this many metres of lap beyond the first few (longer tracks bend more).
    pub bend_spacing_m: f64,
}

/// The biome mix (R125): the weights for a track using one, two, three or four biomes; which biomes, and in which
/// order, are drawn uniformly per seed.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MixData {
    pub one_biome: f64,
    pub two_biomes: f64,
    pub three_biomes: f64,
    pub four_biomes: f64,
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
    pub mix: MixData,
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

    /// The same document with each `(dotted path, json value)` set (`course.classes.standard.lengthMinM`,
    /// `biomes.town.terrain.reliefM`, `mix.twoBiomes`). Refuses an unknown path, a value of the wrong type or one the validator rejects; the original is
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
        let c = &self.course;
        let pos = |name: &str, v: f64, bad: &mut Vec<String>| {
            if !(v > 0.0 && v.is_finite()) {
                bad.push(format!("{name} = {v}: must be positive"));
            }
        };
        {
            let (name, lo, hi) = (
                "course.startStraight",
                c.start_straight_min_m,
                c.start_straight_max_m,
            );
            pos(&format!("{name}MinM"), lo, &mut bad);
            pos(&format!("{name}MaxM"), hi, &mut bad);
            if lo > hi {
                bad.push(format!("{name}MinM {lo} is above {name}MaxM {hi}"));
            }
        }
        pos("course.minStraightM", c.min_straight_m, &mut bad);
        pos("course.bendSpacingM", c.bend_spacing_m, &mut bad);
        if !(0.0..1.0).contains(&c.straight_spread) {
            bad.push(format!(
                "course.straightSpread = {}: must be from 0 up to (not including) 1",
                c.straight_spread
            ));
        }
        let mut total_weight = 0.0;
        for n in ClassName::ALL {
            let k = c.classes.get(n);
            let id = format!("course.classes.{}", n.name());
            if !(k.weight >= 0.0 && k.weight.is_finite()) {
                bad.push(format!("{id}.weight = {}: must not be negative", k.weight));
            }
            total_weight += k.weight;
            pos(&format!("{id}.lengthMinM"), k.length_min_m, &mut bad);
            pos(&format!("{id}.lengthMaxM"), k.length_max_m, &mut bad);
            if k.length_min_m > k.length_max_m {
                bad.push(format!(
                    "{id}.lengthMinM {} is above lengthMaxM {}",
                    k.length_min_m, k.length_max_m
                ));
            }
            if k.length_max_m > 20_000.0 {
                bad.push(format!("{id}.lengthMaxM: above 20 km"));
            }
            if k.laps == 0 {
                bad.push(format!("{id}.laps: at least 1"));
            }
        }
        if total_weight <= 0.0 {
            bad.push("course.classes: every weight is zero".to_owned());
        }
        // The bands are ordered and apart, so a lap length names its class.
        let (s, m, e) = (&c.classes.sprint, &c.classes.standard, &c.classes.epic);
        if s.length_max_m >= m.length_min_m || m.length_max_m >= e.length_min_m {
            bad.push(
                "course.classes: the sprint, standard and epic bands must be in order and not overlap"
                    .to_owned(),
            );
        }
        let mix = self.mix.weights();
        if mix.iter().any(|w| !(*w >= 0.0 && w.is_finite())) || mix.iter().sum::<f64>() <= 0.0 {
            bad.push("mix: weights must not be negative and must not all be zero".to_owned());
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

    /// The class a lap of `length_m` metres belongs to: the one whose band holds it, else the nearest band.
    pub fn class_of_length(&self, length_m: f64) -> ClassName {
        let dist = |k: &LengthClass| {
            if length_m < k.length_min_m {
                k.length_min_m - length_m
            } else {
                (length_m - k.length_max_m).max(0.0)
            }
        };
        let mut best = ClassName::Standard;
        let mut best_d = f64::INFINITY;
        for n in ClassName::ALL {
            let d = dist(self.course.classes.get(n));
            if d < best_d {
                (best, best_d) = (n, d);
            }
        }
        best
    }

    /// The race's default laps for a track whose lap is `length_m` metres (the host may override).
    pub fn laps_for_length(&self, length_m: f64) -> u32 {
        self.course.classes.get(self.class_of_length(length_m)).laps
    }

    /// The biomes of the seed's track in lap order: how many by the mix weights, then which and in what order drawn
    /// uniformly, all from the seed's own `mix` stream (so nothing else's draws move).
    pub fn draw_mix(&self, seed: u64) -> Vec<Biome> {
        let mut rng = crate::seed::Rng::stream(seed, "mix");
        let w = self.mix.weights();
        let total: f64 = w.iter().sum();
        let mut pick = rng.unit() * total;
        let mut count = w.len();
        for (i, x) in w.iter().enumerate() {
            if pick < *x {
                count = i + 1;
                break;
            }
            pick -= x;
        }
        let mut pool = crate::playtest::POOL.to_vec();
        for i in 0..count {
            let j = i + (rng.next_u64() % (pool.len() - i) as u64) as usize;
            pool.swap(i, j);
        }
        pool.truncate(count);
        pool
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
}

impl MixData {
    /// The weights for one, two, three and four biomes.
    pub fn weights(&self) -> [f64; 4] {
        [
            self.one_biome,
            self.two_biomes,
            self.three_biomes,
            self.four_biomes,
        ]
    }
}

impl Biomes {
    pub fn get(&self, b: Biome) -> &BiomeTuning {
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
    fn the_shipped_file_validates_and_matches_the_owner_rulings() {
        let d = GeneratorData::shipped();
        let c = &d.course.classes;
        assert_eq!(
            (c.sprint.weight, c.standard.weight, c.epic.weight),
            (30.0, 50.0, 20.0)
        );
        assert_eq!((c.sprint.laps, c.standard.laps, c.epic.laps), (5, 3, 2));
        assert_eq!(d.mix.weights(), [35.0, 35.0, 15.0, 15.0]);
        assert_eq!(d.class_of_length(750.0), ClassName::Sprint);
        assert_eq!(d.class_of_length(1300.0), ClassName::Standard);
        assert_eq!(d.class_of_length(2400.0), ClassName::Epic);
        assert_eq!(d.laps_for_length(940.0), 5);
    }

    #[test]
    fn a_change_applies_whole_or_not_at_all() {
        let d = GeneratorData::shipped();
        let ok = d
            .with_fields(&[
                ("course.classes.standard.lengthMinM".into(), "1100".into()),
                ("biomes.town.terrain.reliefM".into(), "9.5".into()),
                ("mix.twoBiomes".into(), "10".into()),
            ])
            .unwrap();
        assert_eq!(ok.course.classes.standard.length_min_m, 1100.0);
        assert_eq!(ok.biomes.town.terrain.relief_m, 9.5);
        assert_eq!(ok.mix.two_biomes, 10.0);
        for (path, raw) in [
            ("course.classes.standard.lengthMinM", "5000"),
            ("course.classes.standard.lengthMinM", "-1"),
            ("course.classes.standard.lengthMinM", "700"),
            ("course.classes.standard.laps", "0"),
            ("course.classes.sprint.lengthMaxM", "\"long\""),
            ("course.nope", "1"),
            ("course", "1"),
            ("version", "2"),
            ("mix.oneBiome", "-3"),
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
        d.course.straight_spread = 1.5;
        d.biomes.town.features.creek = -2.0;
        let GeneratorError(lines) = d.validate().unwrap_err();
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(GeneratorData::from_json("{}").is_err());
    }
}
