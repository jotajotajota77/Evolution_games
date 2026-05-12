import { CONFIG } from './config.js';
import { NeuralNet, sigmoid } from './neuralnet.js';
import { computeSensors, SENSOR_COUNT } from './sensors.js';

// Phase 2: NN-controlled motion + asexual reproduction with mutation.
// The brain is a NeuralNet; sensors are computed each tick into a per-organism
// reusable buffer, then fed forward to produce three output intents.
export class Organism {
  constructor(x, y, lineageId = CONFIG.defaultLineage.id, brain = null) {
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

    // Per-individual hue jitter for visual distinction within a lineage.
    this.hueJitter = (Math.random() - 0.5) * 14;
  }

  update(dtSec, world) {
    if (!this.alive) return;
    this.ageSec += dtSec;

    // 1. Sense
    computeSensors(this, world, this.sensorBuffer);

    // 2. Think — three raw outputs, then per-output activations:
    //    out[0] → tanh → turn intent  ∈ [-1, 1]
    //    out[1] → sigmoid → desired speed ∈ [0, 1]
    //    out[2] → sigmoid → reproduce intent ∈ [0, 1]
    const out = this.brain.forward(this.sensorBuffer);
    const turn = Math.tanh(out[0]);
    const desiredSpeed = sigmoid(out[1]);
    const reproduceIntent = sigmoid(out[2]);

    // 3. Apply motion. Constants are calibrated for 60fps and rescaled by dt
    //    so behaviour stays consistent at higher speed multipliers.
    const stepScale = dtSec * CONFIG.targetFps;
    this.heading += turn * CONFIG.organismTurnRate * stepScale;
    this.currentSpeed = desiredSpeed * CONFIG.organismMaxSpeed;

    this.x += Math.cos(this.heading) * this.currentSpeed * stepScale;
    this.y += Math.sin(this.heading) * this.currentSpeed * stepScale;

    // 4. Bounce off bounds. Walls aren't visible to the NN in phase 2, so
    //    reflection keeps wandering organisms from getting stuck on edges.
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    else if (this.x > world.width) { this.x = world.width; this.heading = Math.PI - this.heading; }
    if (this.y < 0) { this.y = 0; this.heading = -this.heading; }
    else if (this.y > world.height) { this.y = world.height; this.heading = -this.heading; }

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
  }

  // Called by world.update once cap-check passes. Splits energy with the child
  // and returns a slightly-mutated descendant with the parent's lineage.
  spawnChild() {
    this.energy *= 0.5;
    const childBrain = this.brain.clone();
    childBrain.mutate(CONFIG.mutationRate, CONFIG.mutationSigma);

    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = Math.random() * CONFIG.childOffsetMax;
    const cx = this.x + Math.cos(offsetAngle) * offsetDist;
    const cy = this.y + Math.sin(offsetAngle) * offsetDist;

    const child = new Organism(cx, cy, this.lineageId, childBrain);
    child.energy = this.energy;
    child.generation = this.generation + 1;

    this.wantsToReproduce = false;
    return child;
  }
}
