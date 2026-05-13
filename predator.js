import { CONFIG } from './config.js';

// Sentinel lineage id for predators. Never appears in any allowedLineages
// set, so all the existing region access helpers (barriers, houses) reject
// predators by default. Zones use a separate `predatorsAllowed` flag.
export const PREDATOR_LINEAGE_ID = -1;

let nextPredatorId = 1;

export function ensureNextPredatorId(min) {
  if (min > nextPredatorId) nextPredatorId = min;
}

// Scripted predator. No NN: steers toward the nearest organism and attacks
// on contact. Energy decays continuously; each kill restores a chunk.
// A short cooldown after a kill avoids machine-gun feeding.
export class Predator {
  constructor(x, y) {
    this.id = nextPredatorId++;
    this.x = x;
    this.y = y;
    this.heading = Math.random() * Math.PI * 2;
    this.currentSpeed = 0;
    this.energy = CONFIG.predatorStartEnergy;
    this.ageSec = 0;
    this.alive = true;
    this.causeOfDeath = null;
    // Marker used by region helpers + sensor code.
    this.lineageId = PREDATOR_LINEAGE_ID;
    this.isPredator = true;
    // Seconds remaining of paralysis (from poison contact). Skips motion +
    // attack while > 0, but energy keeps decaying so a long enough freeze
    // still kills via starvation.
    this.paralysisRemainingSec = 0;
  }

  update(dtSec, world) {
    if (!this.alive) return;
    this.ageSec += dtSec;

    // Poison check — touching any active cloud resets the paralysis timer.
    if (world.poisonAt(this.x, this.y)) {
      this.paralysisRemainingSec = CONFIG.predatorParalysisSec;
    }
    if (this.paralysisRemainingSec > 0) {
      this.paralysisRemainingSec = Math.max(0, this.paralysisRemainingSec - dtSec);
      this.currentSpeed = 0;
      // Still bleeds energy (a bit slower than normal — frozen but not dead).
      this.energy -= CONFIG.predatorEnergyDecayPerSec * 0.6 * dtSec;
      if (this.energy <= 0) {
        this.alive = false;
        this.causeOfDeath = 'starvation';
      }
      return;
    }

    // --- Targeting: nearest live organism within sense range.
    const target = nearestPrey(this, world);

    if (target) {
      // Steer toward target, capped by turn rate.
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const desired = Math.atan2(dy, dx);
      let delta = desired - this.heading;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const maxTurn = CONFIG.predatorTurnRate * dtSec * CONFIG.targetFps;
      if (delta > maxTurn) delta = maxTurn;
      else if (delta < -maxTurn) delta = -maxTurn;
      this.heading += delta;
      this.currentSpeed = CONFIG.predatorMaxSpeed;
    } else {
      // Idle wander — slow drift so predators don't all stack at one spot.
      this.heading += (Math.random() - 0.5) * 0.06;
      this.currentSpeed = CONFIG.predatorMaxSpeed * 0.45;
    }

    const prevX = this.x;
    const prevY = this.y;

    const stepScale = dtSec * CONFIG.targetFps;
    this.x += Math.cos(this.heading) * this.currentSpeed * stepScale;
    this.y += Math.sin(this.heading) * this.currentSpeed * stepScale;

    // Bounce off world bounds.
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    else if (this.x > world.width) { this.x = world.width; this.heading = Math.PI - this.heading; }
    if (this.y < 0) { this.y = 0; this.heading = -this.heading; }
    else if (this.y > world.height) { this.y = world.height; this.heading = -this.heading; }

    // Drawn barriers: same enforcer as organisms — predator's lineage id
    // never appears in any allowedLineages, so they always bounce.
    world.enforceBarrierCrossings(this, prevX, prevY);

    // House + no-predator-zone bouncing.
    world.enforcePredatorBounds(this);

    // --- Attack: every live organism within eat radius dies on this tick.
    //     No cooldown, no energy cap — kills stack directly into reserves.
    //     Spatial grid query first; pad by a few px for grid staleness.
    const er = CONFIG.predatorEatRadius;
    const er2 = er * er;
    const nearby = world.gridOrgs.queryRadius(this.x, this.y, er + 4);
    for (let i = 0; i < nearby.length; i++) {
      const o = nearby[i];
      if (!o.alive) continue;
      const ddx = o.x - this.x;
      const ddy = o.y - this.y;
      if (ddx * ddx + ddy * ddy < er2) {
        o.alive = false;
        o.causeOfDeath = 'predation';
        this.energy += CONFIG.predatorEnergyPerKill;
      }
    }

    // Energy decay; starvation if it falls to zero.
    this.energy -= CONFIG.predatorEnergyDecayPerSec * dtSec;
    if (this.energy <= 0) {
      this.alive = false;
      this.causeOfDeath = 'starvation';
    }
  }
}

function nearestPrey(pred, world) {
  const range = CONFIG.predatorSenseRange;
  let best = null;
  let bestD2 = range * range;
  const candidates = world.gridOrgs.queryRadius(pred.x, pred.y, range + 4);
  for (let i = 0; i < candidates.length; i++) {
    const o = candidates[i];
    if (!o.alive) continue;
    const dx = o.x - pred.x;
    const dy = o.y - pred.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = o; }
  }
  return best;
}
