import { CONFIG } from './config.js';
import { segmentSide, raySegmentT } from './barrier.js';

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

  // Walls (world bounds): always opaque, always blocking. Tested first so
  // they cap each ray's reach; entities further than the wall are pruned.
  testWalls(org, world.width, world.height, range);

  // Broad-phase via spatial grids. Pad the query radius by a couple of
  // pixels to compensate for entities that may have moved since the grid
  // was rebuilt at the start of this tick.
  const slop = 4;
  const foodCandidates = world.gridFood.queryRadius(org.x, org.y, range + CONFIG.foodRadius + slop);
  const orgCandidates  = world.gridOrgs.queryRadius(org.x, org.y, range + CONFIG.organismRadius + slop);
  const predCandidates = world.gridPreds.queryRadius(org.x, org.y, range + CONFIG.predatorRadius + slop);
  testEntities(org, foodCandidates, CONFIG.foodRadius, SENSOR_TYPES.FOOD, 1, range, true);
  testEntities(org, orgCandidates,  CONFIG.organismRadius, SENSOR_TYPES.ORG,  1, range, false);
  testEntities(org, predCandidates, CONFIG.predatorRadius, SENSOR_TYPES.PRED, 1, range, false);

  // Drawn barriers (phase 6). For each ray, only barriers OPAQUE FROM THE
  // ORGANISM'S SIDE compete for the nearest hit; transparent ones are
  // skipped entirely — the ray sees through them to whatever lies beyond.
  testBarriers(org, world.barriers, range);
}

function testWalls(org, worldW, worldH, range) {
  for (let r = 0; r < NUM_RAYS; r++) {
    const dx = _dirX[r], dy = _dirY[r];
    let bestT = _nearestDist[r];
    // Each axis-aligned edge: solve for t where ray hits the plane, then
    // verify the orthogonal coord lies within the world span.
    if (dx !== 0) {
      let t = (0 - org.x) / dx;
      if (t > 0 && t < bestT) {
        const yy = org.y + dy * t;
        if (yy >= 0 && yy <= worldH) bestT = t;
      }
      t = (worldW - org.x) / dx;
      if (t > 0 && t < bestT) {
        const yy = org.y + dy * t;
        if (yy >= 0 && yy <= worldH) bestT = t;
      }
    }
    if (dy !== 0) {
      let t = (0 - org.y) / dy;
      if (t > 0 && t < bestT) {
        const xx = org.x + dx * t;
        if (xx >= 0 && xx <= worldW) bestT = t;
      }
      t = (worldH - org.y) / dy;
      if (t > 0 && t < bestT) {
        const xx = org.x + dx * t;
        if (xx >= 0 && xx <= worldW) bestT = t;
      }
    }
    if (bestT < _nearestDist[r]) {
      _nearestDist[r] = bestT;
      _nearestType[r] = SENSOR_TYPES.WALL;
      _nearestPass[r] = 0;
    }
  }
}

function testBarriers(org, barriers, range) {
  for (let b = 0; b < barriers.length; b++) {
    const bar = barriers[b];
    const pts = bar.points;
    const passable = bar.isAllowed(org.lineageId) ? 1 : 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      // Determine which side of THIS segment the organism is on, and skip
      // if the barrier is transparent from that side.
      const side = segmentSide(p1, p2, org);
      const transparent =
        (side >= 0 && bar.transparentFromSideA) ||
        (side <  0 && bar.transparentFromSideB);
      if (transparent) continue;

      for (let r = 0; r < NUM_RAYS; r++) {
        const t = raySegmentT(org.x, org.y, _dirX[r], _dirY[r], p1, p2, range);
        if (t == null || t >= _nearestDist[r]) continue;
        _nearestDist[r] = t;
        _nearestType[r] = SENSOR_TYPES.BARRIER;
        _nearestPass[r] = passable;
      }
    }
  }
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
  // ZONE_BASE+1 (33): inside any non-house zone — signals "altered rules here"
  // regardless of which lineage owns the zone.
  for (let i = 0; i < world.zones.length; i++) {
    if (world.zones[i].contains(org.x, org.y)) {
      out[ZONE_BASE + 1] = 1;
      break;
    }
  }
}
