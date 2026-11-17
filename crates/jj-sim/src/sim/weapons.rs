//! The weapons' side of the sim (br-bhkz.3): what a weapon's hit does to a car, and the bunger's and the magpie's
//! flights. The item ledger (`crate::items`) commits the use; this steps the physical effect, deterministic and hashed.
//!
//! A weapon's hit is a hit like a ram: it is written to the damage log as an episode whose other body is the thrower's
//! car, so the derby ledger scores it, a wheel it takes is the thrower's wreck, and a spin it causes is a takedown.

use super::*;
use crate::items::bunger::{self, Bunger};
use crate::items::magpie::{self, Swoop};
use crate::items::{Effect as ItemEffect, roo_bar};

impl Sim {
    /// Car `j` is hit by car `by`'s weapon at world point `at`: `impulse` shoves it (authorised in the energy ledger)
    /// and the part nearest `at` loses `damage`. The damage log gets the episode (and the part's change of state), as a
    /// ram's would. Returns the part struck and the health it lost.
    pub(super) fn weapon_hit(
        &mut self,
        j: usize,
        by: u32,
        at: Vector,
        impulse: Vector,
        damage: f32,
        closing: f32,
    ) -> (u8, f32) {
        let tick = self.tick;
        let body = self.cars[j].body;
        let (q, rot, mass, linvel) = {
            let b = &self.world.bodies[body];
            (
                b.position().translation,
                b.position().rotation,
                b.mass(),
                b.linvel(),
            )
        };
        self.ledger += f64::from(impulse.dot(linvel) + impulse.length_squared() / (2.0 * mass));
        if let Some(b) = self.world.bodies.get_mut(body) {
            b.apply_impulse(impulse, true);
        }
        // The struck part: the one whose pivot is nearest the hit, in the car's frame.
        let local = rot.inverse() * (at - q);
        let model = self.cars[j].model;
        let geo = &self.profiles[model].geometry.parts;
        let t = self.profiles[model].tuning.damage.clone();
        let part = (1..self.cars[j].parts.len())
            .filter(|&i| self.cars[j].damage.state(i, &t) != PartState::Detached)
            .min_by(|&a, &b| {
                let d = |i: usize| {
                    geo.get(i).map_or(f32::MAX, |g| {
                        (Vector::new(g.pivot[0], g.pivot[1], g.pivot[2]) - local).length_squared()
                    })
                };
                d(a).total_cmp(&d(b))
            });
        let Some(i) = part else {
            return (0, 0.0);
        };
        let was = self.cars[j].damage.state(i, &t);
        let before = self.cars[j].damage.health[i];
        self.cars[j].damage.charge(i, damage);
        let health = self.cars[j].damage.health[i];
        let now = self.cars[j].damage.state(i, &t);
        let cause = damage::OtherBody::Car { car: by };
        self.damage_events.push((
            tick,
            DamageEvent::Episode(damage::EpisodeRecord {
                car: j as u32,
                part: i as u8,
                other: cause,
                other_owner: Some(damage::Owner { car: by, tick }),
                impulse: impulse.length(),
                closing_mps: closing,
                start_tick: tick,
                last_tick: tick,
                tick,
                damage: before - health,
                health,
            }),
        ));
        if now != was {
            let instigator = Some(by);
            let e = match now {
                PartState::Detached => {
                    self.cars[j].last_detach = Some((cause, instigator));
                    DamageEvent::PartDetached {
                        car: j as u32,
                        part: i as u8,
                        cause,
                        instigator,
                    }
                }
                _ => DamageEvent::PartLoose {
                    car: j as u32,
                    part: i as u8,
                    cause,
                    instigator,
                },
            };
            self.damage_events.push((tick, e));
        }
        (i as u8, before - health)
    }

    /// Whether a weapon may hit car `j` now: never a protected or finished car, and a sanga'd one at `sanga` of it.
    fn weapon_scale(&self, j: usize, sanga: f32) -> Option<f32> {
        if self.cars[j].protected_since.is_some() || self.race.is_finished(j as u32) {
            return None;
        }
        Some(
            if self.sanga_state_at(CarId(j as u32), self.tick).is_some() {
                sanga
            } else {
                1.0
            },
        )
    }

    /// Whether a roo bar is fitted on `car` (br-bhkz.3).
    pub fn roo_bar_active(&self, car: CarId) -> bool {
        roo_bar::active(&self.items, car.0, self.tick)
    }

    /// The bungers thrown this round, lit, gone off or dud, as data (R90).
    pub fn bungers(&self) -> &[Bunger] {
        &self.bungers
    }

    /// The magpies let go this round, flying or finished, as data (R90).
    pub fn magpies(&self) -> &[Swoop] {
        &self.magpies
    }

    /// Starts a bunger for a committed use: lobbed ahead at the nearest rival in the cone in front (at where that car will
    /// be when the fuse runs out), or straight ahead of the car's own motion; a rear throw is let go at rest behind it.
    pub(super) fn throw_bunger(&mut self, car: CarId, effect: &ItemEffect) {
        let Some(c) = self.cars.get(car.0 as usize) else {
            return;
        };
        let Some(b) = self.world.bodies.get(c.body) else {
            return;
        };
        let (pose, me_v) = (*b.position(), b.linvel());
        let fwd = pose.rotation * Vector::Z;
        let f = Vector::new(fwd.x, 0.0, fwd.z).normalize_or_zero();
        let half_l = self.profiles[c.model].chassis_half()[2];
        let fuse = (effect.expires_at - effect.started) as f32 * DT;
        let forward = effect.direction == UtilityKind::Forward;
        let at = pose.translation
            + f * (if forward { half_l + 0.5 } else { -half_l - 0.8 })
            + Vector::Y * 0.9;
        // The lob lands when the fuse runs out: up at half the fuse's fall, and across to its mark.
        let up = 0.5 * 9.81 * fuse;
        let velocity = if forward {
            let mut flat = Vector::new(me_v.x, 0.0, me_v.z) + f * bunger::LOB_MPS;
            let mut best: Option<f32> = None;
            for (j, o) in self.cars.iter().enumerate() {
                if j as u32 == car.0
                    || o.protected_since.is_some()
                    || self.race.is_finished(j as u32)
                {
                    continue;
                }
                let ob = &self.world.bodies[o.body];
                let d = ob.position().translation - pose.translation;
                let flat_d = Vector::new(d.x, 0.0, d.z);
                let dist = flat_d.length();
                if dist < 1.0
                    || dist > bunger::AIM_RANGE_M
                    || flat_d.dot(f) / dist < bunger::AIM_COS
                    || best.is_some_and(|bd| dist >= bd)
                {
                    continue;
                }
                best = Some(dist);
                let ov = ob.linvel();
                let mark = ob.position().translation + Vector::new(ov.x, 0.0, ov.z) * fuse;
                let to = mark - at;
                flat = Vector::new(to.x, 0.0, to.z) / fuse.max(DT);
            }
            flat + Vector::Y * up
        } else {
            Vector::ZERO
        };
        self.bungers.push(Bunger {
            effect: effect.id,
            car: car.0,
            life: c.life,
            position: [at.x, at.y, at.z],
            velocity: [velocity.x, velocity.y, velocity.z],
            landed: false,
            blast_at: effect.expires_at,
            blast: None,
            hits: Vec::new(),
            dud: false,
        });
    }

    /// One tick of every lit bunger: its fall, its landing and, when the fuse runs out, its blast.
    pub(super) fn step_bungers(&mut self) {
        let tick = self.tick;
        for k in 0..self.bungers.len() {
            if !self.bungers[k].lit() {
                continue;
            }
            if !self.bungers[k].landed {
                let b = &self.bungers[k];
                let mut v = Vector::new(b.velocity[0], b.velocity[1], b.velocity[2]);
                let p = Vector::new(b.position[0], b.position[1], b.position[2]);
                v.y -= 9.81 * DT;
                let mut next = p + v * DT;
                let mut landed = false;
                if let Some(g) = self.ground_height(next.x, next.z, p.y.max(next.y) + 2.0)
                    && next.y <= g + bunger::REST_M
                {
                    next.y = g + bunger::REST_M;
                    v = Vector::ZERO;
                    landed = true;
                }
                let b = &mut self.bungers[k];
                b.position = [next.x, next.y, next.z];
                b.velocity = [v.x, v.y, v.z];
                b.landed = landed;
            }
            if tick >= self.bungers[k].blast_at {
                self.blast(k);
            }
        }
    }

    /// Bunger `k` goes off: every rival in the ring is thrown outward and damaged; junk in the ring is thrown and is the
    /// thrower's from now.
    fn blast(&mut self, k: usize) {
        let tick = self.tick;
        let (by, p) = {
            let b = &self.bungers[k];
            (
                b.car,
                Vector::new(b.position[0], b.position[1], b.position[2]),
            )
        };
        self.bungers[k].blast = Some(tick);
        for j in 0..self.cars.len() {
            if j as u32 == by {
                continue;
            }
            let Some(scale) = self.weapon_scale(j, bunger::SANGA_SCALE) else {
                continue;
            };
            let (q, mass) = {
                let b = &self.world.bodies[self.cars[j].body];
                (b.position().translation, b.mass())
            };
            let flat = Vector::new(q.x - p.x, 0.0, q.z - p.z);
            let dist = flat.length();
            if dist >= bunger::BLAST_RADIUS_M || (q.y - p.y).abs() > bunger::BLAST_REACH_Y_M {
                continue;
            }
            let share = bunger::falloff(dist) * scale;
            // Straight up from dead centre.
            let out = if dist > 0.05 {
                flat / dist
            } else {
                Vector::ZERO
            };
            let dv = bunger::BLAST_DV_MPS * share;
            let impulse = (out + Vector::Y * bunger::BLAST_LIFT) * (mass * dv);
            let (part, damage) =
                self.weapon_hit(j, by, p, impulse, bunger::BLAST_DAMAGE * share, dv);
            self.bungers[k].hits.push(bunger::Hit {
                car: j as u32,
                part,
                dv_mps: dv,
                damage,
            });
        }
        // Junk in the ring: thrown outward (its energy authorised), and the thrower's from this tick.
        for i in 0..self.props.len() {
            let h = self.props[i];
            let Some(b) = self.world.bodies.get_mut(h) else {
                continue;
            };
            if !b.is_dynamic() {
                continue;
            }
            let q = b.position().translation;
            let flat = Vector::new(q.x - p.x, 0.0, q.z - p.z);
            let dist = flat.length();
            if dist >= bunger::BLAST_RADIUS_M || (q.y - p.y).abs() > bunger::BLAST_REACH_Y_M {
                continue;
            }
            let out = if dist > 0.05 {
                flat / dist
            } else {
                Vector::ZERO
            };
            let mass = b.mass();
            let impulse = (out + Vector::Y * bunger::BLAST_LIFT)
                * (mass * bunger::JUNK_DV_MPS * bunger::falloff(dist));
            self.ledger +=
                f64::from(impulse.dot(b.linvel()) + impulse.length_squared() / (2.0 * mass));
            b.apply_impulse(impulse, true);
            self.episodes.own_prop(i as u32, by, tick);
        }
    }

    /// The car a magpie let go by `me` swoops: whoever is winning (the most points in a derby, the leader in a race),
    /// among the cars a weapon may hit; the next best when that is `me`.
    fn swoop_target(&self, me: u32) -> Option<u32> {
        let ok = |car: u32| car != me && self.weapon_scale(car as usize, 1.0).is_some();
        match self.derby.as_ref() {
            Some(ledger) => ledger.rows().iter().map(|r| r.car).find(|&c| ok(c)),
            None => self
                .race
                .standings()
                .iter()
                .map(|s| s.car)
                .find(|&c| (c as usize) < self.cars.len() && ok(c)),
        }
    }

    /// Lets a magpie go for a committed use: from over the roof, climbing forward (or backward, for a rear use).
    pub(super) fn release_magpie(&mut self, car: CarId, effect: &ItemEffect) {
        let Some(c) = self.cars.get(car.0 as usize) else {
            return;
        };
        let Some(b) = self.world.bodies.get(c.body) else {
            return;
        };
        let pose = *b.position();
        let fwd = pose.rotation * Vector::Z;
        let sign = if effect.direction == UtilityKind::Forward {
            1.0
        } else {
            -1.0
        };
        let f = Vector::new(fwd.x, 0.0, fwd.z).normalize_or_zero() * sign;
        let heading = (f + Vector::Y * magpie::LAUNCH_UP).normalize_or_zero();
        let at = pose.translation + Vector::Y * magpie::LAUNCH_ABOVE_M;
        self.magpies.push(Swoop {
            effect: effect.id,
            car: car.0,
            life: c.life,
            position: [at.x, at.y, at.z],
            heading: [heading.x, heading.y, heading.z],
            target: self.swoop_target(car.0),
            armed_at: effect.armed_at,
            expires_at: effect.expires_at,
            hit: None,
            ended: None,
        });
    }

    /// One tick of every magpie: it turns toward its target (high until it is near, then down at it), flies on, and
    /// pecks the car it reaches.
    pub(super) fn step_magpies(&mut self) {
        let tick = self.tick;
        for k in 0..self.magpies.len() {
            if !self.magpies[k].active() {
                continue;
            }
            let m = self.magpies[k].clone();
            if tick >= m.expires_at {
                self.magpies[k].ended = Some((tick, magpie::End::Dropped));
                continue;
            }
            // Its target, while a weapon may still hit it; else whoever is winning now.
            let target = m
                .target
                .filter(|&c| c != m.car && self.weapon_scale(c as usize, 1.0).is_some())
                .or_else(|| self.swoop_target(m.car));
            let Some(target) = target else {
                self.magpies[k].ended = Some((tick, magpie::End::Lost));
                continue;
            };
            let q = self.world.bodies[self.cars[target as usize].body]
                .position()
                .translation;
            let p = Vector::new(m.position[0], m.position[1], m.position[2]);
            let plan = libm::hypotf(q.x - p.x, q.z - p.z);
            let aim = q + Vector::Y
                * if plan > magpie::DIVE_M {
                    magpie::CRUISE_M
                } else {
                    magpie::AIM_ABOVE_M
                };
            let want = (aim - p).normalize_or_zero();
            let heading = if want == Vector::ZERO {
                m.heading
            } else {
                magpie::turn_toward(m.heading, [want.x, want.y, want.z], magpie::TURN_RAD_S * DT)
            };
            let dir = Vector::new(heading[0], heading[1], heading[2]);
            let mut next = p + dir * (magpie::SPEED_MPS * DT);
            if let Some(g) = self.ground_height(next.x, next.z, next.y.max(p.y) + 3.0) {
                next.y = next.y.max(g + magpie::FLOOR_M);
            }
            {
                let m = &mut self.magpies[k];
                m.position = [next.x, next.y, next.z];
                m.heading = heading;
                m.target = Some(target);
            }
            if tick < m.armed_at
                || libm::hypotf(next.x - q.x, next.z - q.z) > magpie::HIT_RADIUS_M
                || (next.y - q.y).abs() > magpie::HIT_REACH_Y_M
            {
                continue;
            }
            let j = target as usize;
            let scale = self
                .weapon_scale(j, magpie::SANGA_SCALE)
                .expect("the target may be hit");
            let body = self.cars[j].body;
            let (mass, iso) = {
                let b = &self.world.bodies[body];
                (b.mass(), *b.position())
            };
            let flat = Vector::new(dir.x, 0.0, dir.z).normalize_or_zero();
            let dv = magpie::HIT_DV_MPS * scale;
            let impulse = (flat + Vector::Y * magpie::HIT_LIFT) * (mass * dv);
            let (part, damage) =
                self.weapon_hit(j, m.car, next, impulse, magpie::HIT_DAMAGE * scale, dv);
            // The spin: a yaw kick away from the side it came in on (authorised in the ledger).
            let local = iso.rotation.inverse() * (next - iso.translation);
            let spin = magpie::HIT_SPIN_RAD_S * scale * if local.x >= 0.0 { 1.0 } else { -1.0 };
            if let Some(b) = self.world.bodies.get_mut(body) {
                let inertia = b
                    .mass_properties()
                    .local_mprops
                    .reconstruct_inertia_matrix();
                let ti = iso.rotation * (inertia * Vector::new(0.0, spin, 0.0));
                self.ledger += f64::from(ti.dot(b.angvel()));
                b.apply_torque_impulse(ti, true);
            }
            let m = &mut self.magpies[k];
            m.hit = Some(magpie::Hit {
                tick,
                car: target,
                part,
                dv_mps: dv,
                damage,
            });
            m.ended = Some((tick, magpie::End::Pecked));
        }
    }

    /// A car's health for a HUD, in percent (0 gone .. 100 full; 255: the car has no such part): the front, the back,
    /// the left doors' mean, the right doors' mean and the weakest wheel (a wheel off is a wreck). br-bhkz.2.
    pub fn health_zones(&self, car: CarId) -> Option<[u8; 5]> {
        let c = self.cars.get(car.0 as usize)?;
        let p = &self.profiles[c.model];
        // Per zone: the sum of the parts' health shares and their count, and for the wheels the weakest.
        let mut sum = [0.0f32; 5];
        let mut n = [0u32; 5];
        let mut weakest = 1.0f32;
        for i in 1..c.damage.health.len() {
            let start = c.damage.start[i];
            if start <= 0.0 {
                continue;
            }
            let share = (c.damage.health[i] / start).clamp(0.0, 1.0);
            let name = p.part_name(i);
            let zone = match name {
                "front" => 0,
                "back" => 1,
                _ if name.starts_with("wheel_") => 4,
                _ if name.starts_with("door_") && name.ends_with('L') => 2,
                _ if name.starts_with("door_") => 3,
                _ => continue,
            };
            sum[zone] += share;
            n[zone] += 1;
            if zone == 4 {
                weakest = weakest.min(share);
            }
        }
        let mut out = [255u8; 5];
        for z in 0..5 {
            if n[z] == 0 {
                continue;
            }
            let share = if z == 4 {
                weakest
            } else {
                sum[z] / n[z] as f32
            };
            // A part that still hangs on never reads 0.
            out[z] = if share <= 0.0 {
                0
            } else {
                (libm::ceilf(share * 100.0) as u8).clamp(1, 100)
            };
        }
        Some(out)
    }

    /// The item a fresh car is handed in a derby (the rules' `spawnItem`): drawn by the run's seed, the car and its
    /// life, from the pool of every item. `None` outside a running derby. The host makes the pickup for the car's seat.
    pub fn spawn_item(&self, car: CarId) -> Option<jj_types::items::ItemId> {
        use jj_types::items::ItemId;
        if !self.derby_rules.spawn_item || self.derby.as_ref().is_none_or(|d| d.over(self.tick)) {
            return None;
        }
        let c = self.cars.get(car.0 as usize)?;
        let key = self.journal.seed ^ (u64::from(car.0) << 32) ^ u64::from(c.life);
        let pick = Rng::stream(key, "spawn-item").next_u64() >> 8;
        Some(ItemId::ALL[(pick % ItemId::ALL.len() as u64) as usize])
    }

    /// The round is over: lit bungers are duds and magpies drop. Debris is never touched.
    pub(super) fn drop_weapons(&mut self) {
        let tick = self.tick;
        for b in self.bungers.iter_mut().filter(|b| b.lit()) {
            b.dud = true;
        }
        for m in self.magpies.iter_mut().filter(|m| m.active()) {
            m.ended = Some((tick, magpie::End::Dropped));
        }
    }

    /// The weapons in play for the renderer, as debris records of their own kinds: position, a quaternion (x, y, z, w)
    /// and the snapshot kind word. Magpies face their flight; a lit bunger and its blast sit where it is. A fitted roo
    /// bar's record is not a place: its x is the car it rides and its y the nose's offset along that car, m.
    pub fn weapon_poses(&self) -> Vec<([f32; 3], [f32; 4], u32)> {
        let mut out = Vec::new();
        for m in self.magpies.iter().filter(|m| m.active()) {
            // Yaw about the vertical to face the flight, then pitch along it.
            let [x, y, z] = m.heading;
            let yaw = libm::atan2f(x, z);
            let pitch = -libm::asinf(y.clamp(-1.0, 1.0));
            let (sy, cy) = (libm::sinf(yaw / 2.0), libm::cosf(yaw / 2.0));
            let (sp, cp) = (libm::sinf(pitch / 2.0), libm::cosf(pitch / 2.0));
            out.push((
                m.position,
                [cy * sp, sy * cp, -sy * sp, cy * cp],
                magpie::SNAPSHOT_KIND,
            ));
        }
        for b in &self.bungers {
            if b.lit() {
                out.push((b.position, [0.0, 0.0, 0.0, 1.0], bunger::SNAPSHOT_KIND));
            } else if b.blasting(self.tick) {
                out.push((
                    b.position,
                    [0.0, 0.0, 0.0, 1.0],
                    bunger::SNAPSHOT_KIND_BLAST,
                ));
            }
        }
        for (i, c) in self.cars.iter().enumerate() {
            if !roo_bar::active(&self.items, i as u32, self.tick) {
                continue;
            }
            // Not a place: the car it rides (x) and its nose's offset along the car (y). The renderer draws it on that
            // car's own interpolated pose.
            let nose = self.profiles[c.model].hull_bounds().1[2];
            out.push((
                [i as f32, nose, 0.0],
                [0.0, 0.0, 0.0, 1.0],
                roo_bar::SNAPSHOT_KIND,
            ));
        }
        out
    }
}
