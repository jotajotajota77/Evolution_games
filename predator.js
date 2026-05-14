import { CONFIG } from './config.js';
import { NeuralNet, sigmoid, gaussianRandom, PREDATOR_NN_OPTS } from './neuralnet.js';
import { computePredatorSensors, PREDATOR_SENSOR_COUNT } from './predatorSensors.js';

// Sentinel lineage id for predators. Never appears in any allowedLineages
// set, so all the existing region access helpers (barriers, houses) reject
// predators by default. Zones use a separate `predatorsAllowed` flag.
export const PREDATOR_LINEAGE_ID = -1;

let nextPredatorId = 1;

export function ensureNextPredatorId(min) {
  if (min > nextPredatorId) nextPredatorId = min;
}

// v1.53: predators are NN-driven. Three outputs:
//   out[0] → tanh   → turn intent ∈ [-1, 1]
//   out[1] → sigmoid → desired speed ∈ [0, 1]
//   out[2] → sigmoid → reproduce intent ∈ [0, 1] (gated by CONFIG flag)
// The kill loop is kept as scripted (auto-attack on contact) — making the
// brain learn "press button on contact" wastes evolutionary cycles and
// would regress playability.
export class Predator {
  constructor(x, y, brain = null, colorDrift = null) {
    this.id = nextPredatorId++;
    this.x = x;
    this.y = y;
    this.heading = Math.random() * Math.PI * 2;
    this.currentSpeed = 0;
    this.energy = CONFIG.predatorStartEnergy;
    this.ageSec = 0;
    this.generation = 0;
    this.alive = true;
    this.causeOfDeath = null;
    this.lineageId = PREDATOR_LINEAGE_ID;
    this.isPredator = true;
    this.poisonedRemainingSec = 0;

    this.brain = brain || new NeuralNet(CONFIG.predatorNnArchitecture, null, PREDATOR_NN_OPTS);
    this.sensorBuffer = new Float32Array(PREDATOR_SENSOR_COUNT);
    this.wantsToReproduce = false;

    // Inheritable RGB drift accumulated on mutated births. Founders start
    // at [0,0,0]; clamped per channel in spawnChild.
    this.colorDrift = colorDrift ? [colorDrift[0], colorDrift[1], colorDrift[2]] : [0, 0, 0];

    // Phylogeny tracking — set by world helpers for founders, inherited by
    // descendants in spawnChild.
    this.predSpeciesId = null;
  }

  update(dtSec, world) {
    if (!this.alive) return;
    this.ageSec += dtSec;

    // Poison check — touching any active puff refreshes the slowdown timer.
    if (world.poisonAt(this.x, this.y)) {
      this.poisonedRemainingSec = CONFIG.predatorPoisonedDurationSec;
    }
    if (this.poisonedRemainingSec > 0) {
      this.poisonedRemainingSec = Math.max(0, this.poisonedRemainingSec - dtSec);
    }

    // 1. Sense
    computePredatorSensors(this, world, this.sensorBuffer);

    // 2. Think
    const out = this.brain.forward(this.sensorBuffer);
    const turn = Math.tanh(out[0]);
    const desiredSpeed = sigmoid(out[1]);
    const reproduceIntent = out.length >= 3 ? sigmoid(out[2]) : 0;

    // 3. Apply motion. Same stepScale convention as organisms; predator
    //    constants (turn rate, max speed) calibrated at 60fps.
    const stepScale = dtSec * CONFIG.targetFps;
    this.heading += turn * CONFIG.predatorTurnRate * stepScale;
    this.currentSpeed = desiredSpeed * CONFIG.predatorMaxSpeed;

    // Poison slowdown applied AFTER the brain sets speed — affects whatever
    // the NN chose this tick.
    if (this.poisonedRemainingSec > 0) {
      this.currentSpeed *= CONFIG.predatorPoisonSlowFactor;
    }

    const prevX = this.x;
    const prevY = this.y;
    this.x += Math.cos(this.heading) * this.currentSpeed * stepScale;
    this.y += Math.sin(this.heading) * this.currentSpeed * stepScale;

    // Bounce off world bounds.
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    else if (this.x > world.width) { this.x = world.width; this.heading = Math.PI - this.heading; }
    if (this.y < 0) { this.y = 0; this.heading = -this.heading; }
    else if (this.y > world.height) { this.y = world.height; this.heading = -this.heading; }

    // Drawn barriers + house + no-predator-zone bouncing.
    world.enforceBarrierCrossings(this, prevX, prevY);
    world.enforcePredatorBounds(this);

    // 4. Attack — every live organism within eat radius dies on this tick.
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

    // 5. Energy decay; starvation if it falls to zero.
    this.energy -= CONFIG.predatorEnergyDecayPerSec * dtSec;
    if (this.energy <= 0) {
      this.alive = false;
      this.causeOfDeath = 'starvation';
      return;
    }

    // 6. Reproduction flag — world decides whether to actually spawn
    //    (cap check + global toggle).
    this.wantsToReproduce =
      this.energy >= CONFIG.predatorReproEnergyThresh &&
      reproduceIntent >= CONFIG.predatorReproIntentThresh;
  }

  // Called by world.update once cap-check + toggle passes. Mirrors the
  // organism's asexual budding: parent keeps unmutated brain (well-adapted
  // genome preserved), child gets a clone that mutates with probability
  // CONFIG.mutationEventChance. Drift accumulates only on the mutated path.
  spawnChild() {
    this.energy *= 0.5;

    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = Math.random() * CONFIG.predatorChildOffsetMax;
    const cx = this.x + Math.cos(offsetAngle) * offsetDist;
    const cy = this.y + Math.sin(offsetAngle) * offsetDist;

    const childBrain = this.brain.clone();
    let drift;
    if (Math.random() < CONFIG.mutationEventChance) {
      childBrain.mutate(CONFIG.predatorMutationRate, CONFIG.predatorMutationSigma);
      const sig = CONFIG.predatorColorDriftSigma;
      const mx = CONFIG.predatorColorDriftMax;
      drift = [
        clampDrift(this.colorDrift[0] + gaussianRandom() * sig, mx),
        clampDrift(this.colorDrift[1] + gaussianRandom() * sig, mx),
        clampDrift(this.colorDrift[2] + gaussianRandom() * sig, mx),
      ];
    } else {
      drift = [this.colorDrift[0], this.colorDrift[1], this.colorDrift[2]];
    }

    const child = new Predator(cx, cy, childBrain, drift);
    child.energy = this.energy;
    child.generation = this.generation + 1;
    child.predSpeciesId = this.predSpeciesId;

    this.wantsToReproduce = false;
    return child;
  }
}

function clampDrift(v, mx) {
  return v > mx ? mx : (v < -mx ? -mx : v);
}
