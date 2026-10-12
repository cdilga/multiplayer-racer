//! Declared roof-jump targets: every house remains physical scenery, while authored stunt landings
//! must be reachable at their stated design speed. No invisible receiving platform is introduced.
use crate::{Dressing, Feature, Map, jump::JumpDesign};

/// The visible town kit's roof at a world position, metres (the gable and verandah sheet).
pub fn height_m(house: &Dressing, x: f64, z: f64) -> Option<f64> {
    if house.kit_piece != "town/house" {
        return None;
    }
    let a = f64::from(house.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
    let (dx, dz) = (
        x - f64::from(house.pose.x) / 1000.0,
        z - f64::from(house.pose.z) / 1000.0,
    );
    let (w, depth, height) = (
        house.params.get("widthMm")?,
        house.params.get("depthMm")?,
        house.params.get("heightCm")?,
    );
    let (lx, lz) = (
        (dx * libm::cos(a) + dz * libm::sin(a)) / (*w as f64 / 1000.0),
        (-dx * libm::sin(a) + dz * libm::cos(a)) / (*depth as f64 / 1000.0),
    );
    if lx.abs() > 0.5 || !(-0.5..=0.5).contains(&lz) {
        return None;
    }
    let y = if lz <= 0.28 {
        0.6 + 0.4 * (1.0 - (lz + 0.11).abs() / 0.39)
    } else {
        // Top of the renderer's 0.012-thick lean-to sheet, measured vertically.
        0.56 - 0.09 * (lz - 0.24) / 0.26 + 0.006 * libm::sqrt(1.0 + (0.09_f64 / 0.26).powi(2))
    };
    Some(f64::from(house.pose.y) / 1000.0 + y * *height as f64 / 100.0)
}

/// Named defects for a free-standing kicker whose `roofTarget` indexes the map's dressing.
pub fn problems(map: &Map, f: &Feature) -> Vec<String> {
    let fail = |s: &str| vec![s.to_owned()];
    let Some(index) = f
        .params
        .get("roofTarget")
        .and_then(|i| usize::try_from(*i).ok())
    else {
        return fail("roofTarget must name a dressing index");
    };
    let Some(house) = map
        .dressing
        .get(index)
        .filter(|h| h.kit_piece == "town/house" && h.collides)
    else {
        return fail("roofTarget must name a colliding town house");
    };
    let Some(d) = JumpDesign::of(f) else {
        return fail("a roof kicker needs sharp=1 and ramp geometry");
    };
    if d.ramp_m < crate::limits::MIN_RAMP_LENGTH_MM as f64 / 1000.0
        || d.ramp_w < 2.0
        || d.lip <= 0.0
        || d.lip > crate::limits::MAX_LIP_HEIGHT_CM as f64 / 100.0
        || d.blend_m < 0.0
        || d.blend_m > d.ramp_m
    {
        return fail("invalid roof kicker dimensions or transition");
    }
    let speed = f
        .params
        .get("designSpeedMmps")
        .map_or(crate::limits::JUMP_DESIGN_SPEED_MPS, |v| *v as f64 / 1000.0);
    if speed <= 0.0 {
        return fail("roof design speed must be positive");
    }
    let bounds = &map.header.bounds;
    for u in [0.0, d.ramp_m] {
        for lat in [
            -d.ramp_w / 2.0 - crate::jump::EDGE_SLOPE_M,
            d.ramp_w / 2.0 + crate::jump::EDGE_SLOPE_M,
        ] {
            let p = crate::jump::surface_point(map, f, &d, u, lat);
            if p[0] * 1000.0 < bounds.min_x as f64
                || p[0] * 1000.0 > bounds.max_x as f64
                || p[2] * 1000.0 < bounds.min_z as f64
                || p[2] * 1000.0 > bounds.max_z as f64
            {
                return fail("roof kicker leaves the map bounds");
            }
        }
    }
    let lip = crate::jump::surface_point(map, f, &d, d.ramp_m, 0.0);
    let before = crate::jump::surface_point(map, f, &d, d.ramp_m - 0.25, 0.0);
    let slope = (lip[1] - before[1]) / 0.25;
    let vx = speed / libm::sqrt(1.0 + slope * slope);
    let a = f64::from(f.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
    let tangent = [libm::cos(a), libm::sin(a)];
    let normal = [-tangent[1], tangent[0]];
    let (Some(&depth), Some(&height)) = (house.params.get("depthMm"), house.params.get("heightCm"))
    else {
        return fail("roof target needs its house dimensions");
    };
    if depth <= 0 || height <= 0 {
        return fail("invalid roof target dimensions");
    }
    let h = height as f64 / 100.0;
    let ha = f64::from(house.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
    let (dx, dz) = (
        lip[0] - f64::from(house.pose.x) / 1000.0,
        lip[2] - f64::from(house.pose.z) / 1000.0,
    );
    let lz = (-dx * libm::sin(ha) + dz * libm::cos(ha)) / (depth as f64 / 1000.0);
    let dz_per_m =
        (-tangent[0] * libm::sin(ha) + tangent[1] * libm::cos(ha)) / (depth as f64 / 1000.0);
    // Intersect the ballistic arc with each of the three actual roof planes analytically. Work is
    // independent of flight length/speed, including malformed data; there is no sampling budget.
    let q = 9.81 / (2.0 * vx * vx);
    for (lo, hi, intercept, gradient) in [
        (-0.5, -0.11, 0.6 + 0.4 * 0.5 / 0.39, 0.4 / 0.39),
        (-0.11, 0.28, 0.6 + 0.4 * 0.28 / 0.39, -0.4 / 0.39),
        (
            0.28,
            0.5,
            0.56 + 0.09 * 0.24 / 0.26 + 0.006 * libm::sqrt(1.0 + (0.09_f64 / 0.26).powi(2)),
            -0.09 / 0.26,
        ),
    ] {
        let b = slope - h * gradient * dz_per_m;
        let c = lip[1] - (f64::from(house.pose.y) / 1000.0 + h * (intercept + gradient * lz));
        let disc = b * b + 4.0 * q * c;
        if disc < 0.0 {
            continue;
        }
        let run = (b + libm::sqrt(disc)) / (2.0 * q);
        if !run.is_finite() || run <= 0.0 || !(lo..=hi).contains(&(lz + dz_per_m * run)) {
            continue;
        }
        let (x, z) = (lip[0] + tangent[0] * run, lip[2] + tangent[1] * run);
        if slope - 9.81 * run / (vx * vx) < 0.0 {
            // A five-by-two-metre car footprint must fit, including every corner. This is clearance,
            // not a participant or model count budget. Rapier scenarios remain the dynamic acceptance.
            let fits = [-2.5, 2.5].into_iter().all(|u| {
                [-1.0, 1.0].into_iter().all(|lat| {
                    height_m(
                        house,
                        x + tangent[0] * u + normal[0] * lat,
                        z + tangent[1] * u + normal[1] * lat,
                    )
                    .is_some()
                })
            });
            if fits {
                return Vec::new();
            }
        }
    }
    fail("no descending flight at the design speed lands a car footprint on this roof")
}
