import { CONFIG } from './config.js';
import { NeuralNet, sigmoid, gaussianRandom } from './neuralnet.js';
import { computeSensors, SENSOR_COUNT } from './sensors.js';

// Phase 2: NN-controlled motion + asexual reproduction with mutation.
// The brain is a NeuralNet; sensors are computed each tick into a per-organism
// reusable buffer, then fed forward to produce three output intents.
export class Organism {
  constructor(x, y, lineageId = CONFIG.defaultLineage.id, brain = null, colorDrift = null) {
    this.x = x;
    this.y = y;
    this.heading = Math.random() * Math.PI * 2;
    this.currentSpeed = CONFIG.organismMaxSpeed * 0.5; // overwritten each tick by NN
    this.energy = CONFIG.organismStartEnergy;
    this.ageSec = 0;
    this.lineageId = lineageId;
    this.generation = 0;
    this.alive = true;
    this.causeOfDeath = null;

    this.brain = brain || new NeuralNet();
    this.sensorBuffer = new Float32Array(SENSOR_COUNT);
    this.wantsToReproduce = false;
    // Fractional puff accumulator — emit one puff each time it crosses 1.
    // Lets sub-1 emit rates (intent < 1.0) still produce puffs at the
    // right average frequency.
    this._poisonAccum = 0;

    // Inheritable per-individual colour offset. Founders start at zero; each
    // birth accumulates a small gaussian step (see spawnChild).
    this.colorDrift = colorDrift ? [colorDrift[0], colorDrift[1], colorDrift[2]] : [0, 0, 0];

    // Phylogeny node ids — one per tracking mode (classic + budding).
    // Set by world helpers for founders; inherited by descendants in spawnChild.
    this.speciesId = null;
    this.budSpeciesId = null;
  }

  update(dtSec, world) {
    if (!this.alive) return;
    this.ageSec += dtSec;

    // 1. Sense
    computeSensors(this, world, this.sensorBuffer);

    // 2. Think — four raw outputs, then per-output activations:
    //    out[0] → tanh → turn intent  ∈ [-1, 1]
    //    out[1] → sigmoid → desired speed ∈ [0, 1]
    //    out[2] → sigmoid → reproduce intent ∈ [0, 1]
    //    out[3] → sigmoid → poison emit intent ∈ [0, 1]
    const out = this.brain.forward(this.sensorBuffer);
    const turn = Math.tanh(out[0]);
    const desiredSpeed = sigmoid(out[1]);
    const reproduceIntent = sigmoid(out[2]);
    // out[3] may be undefined on legacy brains that never got migrated;
    // defensive check just in case.
    const poisonIntent = out.length >= 4 ? sigmoid(out[3]) : 0;

    // 3. Apply motion. Constants are calibrated for 60fps and rescaled by dt
    //    so behaviour stays consistent at higher speed multipliers.
    const stepScale = dtSec * CONFIG.targetFps;
    this.heading += turn * CONFIG.organismTurnRate * stepScale;
    this.currentSpeed = desiredSpeed * CONFIG.organismMaxSpeed;

    const prevX = this.x;
    const prevY = this.y;
    this.x += Math.cos(this.heading) * this.currentSpeed * stepScale;
    this.y += Math.sin(this.heading) * this.currentSpeed * stepScale;

    // 4a. Bounce off world bounds.
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    else if (this.x > world.width) { this.x = world.width; this.heading = Math.PI - this.heading; }
    if (this.y < 0) { this.y = 0; this.heading = -this.heading; }
    else if (this.y > world.height) { this.y = world.height; this.heading = -this.heading; }

    // 4b. Bounce off any drawn barrier the lineage can't cross (phase 6).
    world.enforceBarrierCrossings(this, prevX, prevY);

    // 4c. Bounce out of any zone the lineage isn't allowed into.
    world.enforceZoneAccess(this);

    // 5. Eat anything within reach. Each pellet carries the energy value of
    //    the zone it spawned in, so house-grown food can be more nutritious.
    const food = world.nearestFood(this.x, this.y, CONFIG.organismEatRadius);
    if (food) {
      food.eaten = true;
      const gain = food.energy != null ? food.energy : CONFIG.foodEnergy;
      this.energy = Math.min(CONFIG.organismMaxEnergy, this.energy + gain);
    }

    // 6. Energy decay (base + speed-scaled), modulated by the zone the organism
    //    is currently in. Phase 4 also adds a night penalty: organisms outside
    //    their own house's zone burn more energy after dark.
    const speedNorm = this.currentSpeed / CONFIG.organismMaxSpeed;
    const zoneMult = world.zoneDecayMultiplierAt(this.x, this.y);

    const lin = world.lineages.get(this.lineageId);
    const inOwnHouse = !!(lin && lin.house && lin.house.contains(this.x, this.y));
    const nightFactor = 1 - world.daylight;          // 0 at noon, 1 at midnight
    const nightMult = inOwnHouse ? 1 : (1 + nightFactor * CONFIG.organismNightDecayBonus);

    const decay = CONFIG.organismEnergyDecayPerSec
      * (1 + (CONFIG.organismEnergyDecayMoveMult - 1) * speedNorm)
      * zoneMult
      * nightMult;
    this.energy -= decay * dtSec;

    // 7. Death.
    if (this.energy <= 0) {
      this.alive = false;
      this.causeOfDeath = 'starvation';
      return;
    }
    if (this.ageSec >= CONFIG.organismMaxAgeSec) {
      this.alive = false;
      this.causeOfDeath = 'age';
      return;
    }

    // 8. Reproduction flag — world decides whether to actually spawn (cap check).
    this.wantsToReproduce =
      this.energy >= CONFIG.organismMaxEnergy * CONFIG.reproductionEnergyThresh &&
      reproduceIntent >= CONFIG.reproductionIntentThresh;

    // 9. Continuous poison trail. The organism pays energy proportional to
    //    intent every tick (no gate, no cooldown) and drops puffs at a rate
    //    that scales with intent too. High sustained intent burns through
    //    reserves fast — over-emission really does kill via starvation.
    //    No house exemption: evolution is left to discover that emitting
    //    inside the safe zone is wasteful and select against it via cost.
    if (poisonIntent > CONFIG.poisonNoiseFloor) {
      this.energy -= poisonIntent * CONFIG.poisonCostPerSec * dtSec;
      this._poisonAccum += poisonIntent * CONFIG.poisonEmitsPerSec * dtSec;
      while (this._poisonAccum >= 1) {
        world.emitPoison(this.x, this.y, this.lineageId, poisonIntent);
        this._poisonAccum -= 1;
      }
      // Starving on poison counts as starvation, same as any energy depletion.
      if (this.energy <= 0) {
        this.alive = false;
        this.causeOfDeath = 'starvation';
      }
    } else {
      this._poisonAccum = 0;
    }
  }

  // Called by world.update once cap-check passes. Splits energy with the child
  // and returns a slightly-mutated descendant with the parent's lineage.
  spawnChild() {
    this.energy *= 0.5;

    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = Math.random() * CONFIG.childOffsetMax;
    const cx = this.x + Math.cos(offsetAngle) * offsetDist;
    const cy = this.y + Math.sin(offsetAngle) * offsetDist;

    // The parent (this) keeps its brain untouched — it's effectively the
    // "unmutated daughter" that preserves the well-adapted genome. The new
    // child either inherits an exact clone OR a mutated copy, depending on
    // the per-birth mutation gate. Colour drift mirrors mutation: an exact
    // clone keeps the same colour drift, a mutated child accumulates a step.
    const childBrain = this.brain.clone();
    let drift;
    if (Math.random() < CONFIG.mutationEventChance) {
      childBrain.mutate(CONFIG.mutationRate, CONFIG.mutationSigma);
      const sig = CONFIG.colorDriftSigma;
      const mx = CONFIG.colorDriftMax;
      drift = [
        clampDrift(this.colorDrift[0] + gaussianRandom() * sig, mx),
        clampDrift(this.colorDrift[1] + gaussianRandom() * sig, mx),
        clampDrift(this.colorDrift[2] + gaussianRandom() * sig, mx),
      ];
    } else {
      drift = [this.colorDrift[0], this.colorDrift[1], this.colorDrift[2]];
    }

    const child = new Organism(cx, cy, this.lineageId, childBrain, drift);
    child.energy = this.energy;
    child.generation = this.generation + 1;
    child.speciesId = this.speciesId;
    child.budSpeciesId = this.budSpeciesId;

    this.wantsToReproduce = false;
    return child;
  }
}

function clampDrift(v, mx) {
  return v > mx ? mx : (v < -mx ? -mx : v);
}
