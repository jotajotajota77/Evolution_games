import { CONFIG } from './config.js';
import { segmentSide, raySegmentT } from './barrier.js';

// Predator sensor layout. Separate from the organism's sensors.js because
// predators look at the world differently: no FOOD sensing, no house, no
// time-of-day, and they ignore zone enforcement (it's done by world code,
// not the brain). The vector is intentionally smaller (22) so the brain
// stays compact.
//
//   [0..N*2-1]   vision: N rays × 2 values (distance, type)
//   [N*2 + 0]    energy   (clamped 0..2 — no max-energy cap on predators)
//   [N*2 + 1]    speed
//   [N*2 + 2]    age
//   [N*2 + 3]    poisoned remaining fraction
//   [N*2 + 4]    in any non-house zone flag (0/1)
//   [N*2 + 5]    constant 1.0 — cheap learnable offset
const NUM_RAYS = CONFIG.predatorVisionRays;
export const VISION_BASE = 0;
export const PROP_BASE   = NUM_RAYS * 2;
export const PREDATOR_SENSOR_COUNT = PROP_BASE + 6;

// Predator-side type encoding. Equally spaced scalars so the NN can treat
// the channel as a soft category. No FOOD slot.
export const PRED_SENSOR_TYPES = {
  NONE: 0,
  PREY: 0.35,
  PRED_POISONED: 0.45,
  PRED: 0.6,
  POISON_PUFF: 0.75,
  WALL: 0.9,
  BARRIER: 1.0,
};

// Module-level scratch arrays — reused so per-frame sensor work allocates
// nothing once warmed up.
const _dirX = new Float32Array(NUM_RAYS);
const _dirY = new Float32Array(NUM_RAYS);
const _nearestDist = new Float32Array(NUM_RAYS);
const _nearestType = new Float32Array(NUM_RAYS);

function fillVision(pred, world) {
  const range = CONFIG.predatorVisionRange;
  const fan = CONFIG.predatorVisionFan;
  const fullCircle = fan >= Math.PI * 1.99;
  const angleStep = fullCircle
    ? (2 * Math.PI) / NUM_RAYS
    : (NUM_RAYS > 1 ? fan / (NUM_RAYS - 1) : 0);
  const startAngle = fullCircle ? pred.heading : pred.heading - fan / 2;

  for (let r = 0; r < NUM_RAYS; r++) {
    const a = startAngle + r * angleStep;
    _dirX[r] = Math.cos(a);
    _dirY[r] = Math.sin(a);
    _nearestDist[r] = range;
    _nearestType[r] = PRED_SENSOR_TYPES.NONE;
  }

  testWalls(pred, world.width, world.height, range);

  // Broad-phase via world spatial grids. Padding compensates for entities
  // that moved between grid rebuild and sensor read.
  const slop = 4;
  const orgCandidates  = world.gridOrgs.queryRadius(pred.x, pred.y, range + CONFIG.organismRadius + slop);
  const predCandidates = world.gridPreds.queryRadius(pred.x, pred.y, range + CONFIG.predatorRadius + slop);
  testEntities(pred, orgCandidates,  CONFIG.organismRadius, PRED_SENSOR_TYPES.PREY, range, false);
  testEntities(
    pred, predCandidates, CONFIG.predatorRadius,
    (other) => (other.poisonedRemainingSec > 0 ? PRED_SENSOR_TYPES.PRED_POISONED : PRED_SENSOR_TYPES.PRED),
    range, false,
  );
  // Poison puffs are small radii treated as obstacles to avoid. world.poisons
  // is the canonical list; no spatial grid for them, count is small.
  testEntities(pred, world.poisons, CONFIG.poisonRadius, PRED_SENSOR_TYPES.POISON_PUFF, range, true);

  testBarriers(pred, world.barriers, range);
}

function testWalls(pred, worldW, worldH, range) {
  for (let r = 0; r < NUM_RAYS; r++) {
    const dx = _dirX[r], dy = _dirY[r];
    let bestT = _nearestDist[r];
    if (dx !== 0) {
      let t = (0 - pred.x) / dx;
      if (t > 0 && t < bestT) {
        const yy = pred.y + dy * t;
        if (yy >= 0 && yy <= worldH) bestT = t;
      }
      t = (worldW - pred.x) / dx;
      if (t > 0 && t < bestT) {
        const yy = pred.y + dy * t;
        if (yy >= 0 && yy <= worldH) bestT = t;
      }
    }
    if (dy !== 0) {
      let t = (0 - pred.y) / dy;
      if (t > 0 && t < bestT) {
        const xx = pred.x + dx * t;
        if (xx >= 0 && xx <= worldW) bestT = t;
      }
      t = (worldH - pred.y) / dy;
      if (t > 0 && t < bestT) {
        const xx = pred.x + dx * t;
        if (xx >= 0 && xx <= worldW) bestT = t;
      }
    }
    if (bestT < _nearestDist[r]) {
      _nearestDist[r] = bestT;
      _nearestType[r] = PRED_SENSOR_TYPES.WALL;
    }
  }
}

function testBarriers(pred, barriers, range) {
  // Predators have lineageId = -1 (the predator sentinel). Barriers may or
  // may not allow them through; we don't expose passability to the brain
  // (it gates speed via zone enforcement instead), but we still respect
  // barrier opacity per side.
  for (let b = 0; b < barriers.length; b++) {
    const bar = barriers[b];
    const pts = bar.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const side = segmentSide(p1, p2, pred);
      const transparent =
        (side >= 0 && bar.transparentFromSideA) ||
        (side <  0 && bar.transparentFromSideB);
      if (transparent) continue;

      for (let r = 0; r < NUM_RAYS; r++) {
        const t = raySegmentT(pred.x, pred.y, _dirX[r], _dirY[r], p1, p2, range);
        if (t == null || t >= _nearestDist[r]) continue;
        _nearestDist[r] = t;
        _nearestType[r] = PRED_SENSOR_TYPES.BARRIER;
      }
    }
  }
}

function testEntities(pred, list, eRadius, type, range, skipEaten) {
  const r2 = eRadius * eRadius;
  const reachSq = (range + eRadius) * (range + eRadius);
  const typeIsFn = typeof type === 'function';

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (skipEaten) {
      // Poison puffs use ageSec, not 'eaten'; reject expired ones the same
      // way as eaten food.
      if (e.eaten || (e.ageSec != null && e.ageSec >= (CONFIG.poisonDurationSec || Infinity))) continue;
    } else {
      if (e === pred || !e.alive) continue;
    }

    const dx = e.x - pred.x;
    const dy = e.y - pred.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;
    const entType = typeIsFn ? type(e) : type;

    for (let r = 0; r < NUM_RAYS; r++) {
      const tca = dx * _dirX[r] + dy * _dirY[r];
      if (tca < 0) continue;
      const d2 = distSq - tca * tca;
      if (d2 > r2) continue;
      const thc = Math.sqrt(r2 - d2);
      const t0 = tca - thc;
      if (t0 < 0 || t0 > range) continue;
      if (t0 < _nearestDist[r]) {
        _nearestDist[r] = t0;
        _nearestType[r] = entType;
      }
    }
  }
}

export function computePredatorSensors(pred, world, out) {
  out.fill(0);

  fillVision(pred, world);

  const range = CONFIG.predatorVisionRange;
  for (let r = 0; r < NUM_RAYS; r++) {
    const i = VISION_BASE + r * 2;
    out[i]     = _nearestDist[r] / range;
    out[i + 1] = _nearestType[r];
  }

  // Proprio (6 fields).
  // Predators have no energy cap; clamp the ratio so the input never
  // diverges if a predator chains kills.
  out[PROP_BASE]     = Math.min(2, pred.energy / CONFIG.predatorStartEnergy);
  out[PROP_BASE + 1] = pred.currentSpeed / CONFIG.predatorMaxSpeed;
  out[PROP_BASE + 2] = Math.min(1, pred.ageSec / 60);
  out[PROP_BASE + 3] = pred.poisonedRemainingSec > 0
    ? Math.min(1, pred.poisonedRemainingSec / CONFIG.predatorPoisonedDurationSec)
    : 0;
  // In any non-house zone — gives the brain a hint that the world bounces it.
  let inForeignZone = 0;
  for (let i = 0; i < world.zones.length; i++) {
    if (world.zones[i].contains(pred.x, pred.y)) { inForeignZone = 1; break; }
  }
  out[PROP_BASE + 4] = inForeignZone;
  // Constant 1.0 — cheap learnable offset slot.
  out[PROP_BASE + 5] = 1;
}
