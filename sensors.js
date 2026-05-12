import { CONFIG } from './config.js';

// Sensor layout (34 inputs total):
//   [0..23]  vision: 8 rays * 3 values (distance, type, passable)
//   [24]     energy
//   [25]     speed
//   [26]     age
//   [27..28] sin/cos day-time      (zero in phases 1-3)
//   [29..31] dist/sin/cos to house (zero in phases 1-2)
//   [32..33] in own zone / in foreign zone (zero in phases 1-4)
export const SENSOR_COUNT = 34;
export const VISION_BASE = 0;
export const PROP_BASE = 24;
export const TIME_BASE = 27;
export const HOUSE_BASE = 29;
export const ZONE_BASE = 32;

// Type encoding for the second value of each ray. The chosen scalars are
// equally spaced so the NN can treat the input as a soft category code.
export const SENSOR_TYPES = {
  NONE: 0,
  FOOD: 0.2,
  ORG: 0.4,
  PRED: 0.6,
  WALL: 0.8,
  BARRIER: 1.0,
};
// Convention for the third "passable" value:
//   - food / organism / predator → 1 (the body itself doesn't block movement)
//   - wall                       → 0 (always blocking)
//   - barrier                    → 1 if the organism's lineage is allowed, else 0
//   - none (no detection)        → 0

// Module-level scratch arrays — reused so per-frame sensor work allocates
// nothing once warmed up.
const NUM_RAYS = CONFIG.visionRays;
const _dirX = new Float32Array(NUM_RAYS);
const _dirY = new Float32Array(NUM_RAYS);
const _nearestDist = new Float32Array(NUM_RAYS);
const _nearestType = new Float32Array(NUM_RAYS);
const _nearestPass = new Float32Array(NUM_RAYS);

function fillVision(org, world) {
  const range = CONFIG.visionRange;
  const fan = CONFIG.visionFanRad;
  const startAngle = org.heading - fan / 2;
  const angleStep = NUM_RAYS > 1 ? fan / (NUM_RAYS - 1) : 0;

  for (let r = 0; r < NUM_RAYS; r++) {
    const a = startAngle + r * angleStep;
    _dirX[r] = Math.cos(a);
    _dirY[r] = Math.sin(a);
    _nearestDist[r] = range;
    _nearestType[r] = SENSOR_TYPES.NONE;
    _nearestPass[r] = 0;
  }

  // Phase 2: only food and other organisms are detectable.
  // Walls/barriers/predators activate in phases 6-7.
  testEntities(org, world.food, CONFIG.foodRadius, SENSOR_TYPES.FOOD, 1, range, true);
  testEntities(org, world.organisms, CONFIG.organismRadius, SENSOR_TYPES.ORG, 1, range, false);
}

// Common helper for any list of circular entities. `skipEaten` filters food
// pellets; for organisms we instead skip self / dead.
function testEntities(org, list, eRadius, type, passable, range, skipEaten) {
  const r2 = eRadius * eRadius;
  const reachSq = (range + eRadius) * (range + eRadius);

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (skipEaten) {
      if (e.eaten) continue;
    } else {
      if (e === org || !e.alive) continue;
    }

    const dx = e.x - org.x;
    const dy = e.y - org.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;

    // Test this entity against each ray. With small entities (~3-4 px) and a
    // ~17° gap between rays, an entity rarely registers on more than one ray.
    for (let r = 0; r < NUM_RAYS; r++) {
      const tca = dx * _dirX[r] + dy * _dirY[r];
      if (tca < 0) continue;                   // behind the ray origin
      const d2 = distSq - tca * tca;
      if (d2 > r2) continue;                   // ray misses this circle
      const thc = Math.sqrt(r2 - d2);
      const t0 = tca - thc;                    // entry point along the ray
      if (t0 < 0 || t0 > range) continue;
      if (t0 < _nearestDist[r]) {
        _nearestDist[r] = t0;
        _nearestType[r] = type;
        _nearestPass[r] = passable;
      }
    }
  }
}

export function computeSensors(org, world, out) {
  // out is a Float32Array of length SENSOR_COUNT, owned by the organism.
  out.fill(0);

  fillVision(org, world);

  const range = CONFIG.visionRange;
  for (let r = 0; r < NUM_RAYS; r++) {
    const i = VISION_BASE + r * 3;
    out[i]     = _nearestDist[r] / range;     // 0 = touching, 1 = nothing in range
    out[i + 1] = _nearestType[r];
    out[i + 2] = _nearestPass[r];
  }

  // Proprioception
  out[PROP_BASE]     = org.energy / CONFIG.organismMaxEnergy;
  out[PROP_BASE + 1] = org.currentSpeed / CONFIG.organismMaxSpeed;
  out[PROP_BASE + 2] = Math.min(1, org.ageSec / CONFIG.organismMaxAgeSec);

  // Time slots (27-28): sin/cos of dayPhase. Continuous + smooth so the NN
  // can learn arbitrary day/night responses without a wrap discontinuity.
  const phase = world.dayPhase || 0;
  const tau = 2 * Math.PI * phase;
  out[TIME_BASE]     = Math.sin(tau);
  out[TIME_BASE + 1] = Math.cos(tau);

  // House sensors (29-31): innate spatial reference to the lineage's home.
  // Computed every frame from geometry — independent of vision.
  const lineage = world.lineages.get(org.lineageId);
  const house = lineage ? lineage.house : null;
  if (house) {
    const dx = house.x - org.x;
    const dy = house.y - org.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const diag = Math.sqrt(world.width * world.width + world.height * world.height);
    out[HOUSE_BASE]     = Math.min(1, dist / diag);
    // Angle to house relative to current heading. sin/cos avoid the wrap
    // discontinuity that a raw angle scalar would introduce.
    const rel = Math.atan2(dy, dx) - org.heading;
    out[HOUSE_BASE + 1] = Math.sin(rel);
    out[HOUSE_BASE + 2] = Math.cos(rel);

    // Zone status (32): inside own house's zone.
    if (dx * dx + dy * dy <= house.radius * house.radius) {
      out[ZONE_BASE] = 1;
    }
  }
  // ZONE_BASE+1 (foreign non-house zone) stays zero — phase 5.
}
