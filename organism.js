import { CONFIG } from './config.js';

// Phase 1: pure random walk with smooth heading drift and an eat-on-contact rule.
// The neural network and sensors arrive in phase 2.
export class Organism {
  constructor(x, y, lineageId = CONFIG.defaultLineage.id) {
    this.x = x;
    this.y = y;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = CONFIG.organismMaxSpeed * (0.5 + Math.random() * 0.5);
    this.energy = CONFIG.organismStartEnergy;
    this.ageSec = 0;
    this.lineageId = lineageId;
    this.generation = 0;
    this.alive = true;
    this.causeOfDeath = null;
    // Per-individual hue jitter so siblings are visually distinguishable later.
    this.hueJitter = (Math.random() - 0.5) * 14;
  }

  update(dtSec, world) {
    if (!this.alive) return;

    this.ageSec += dtSec;

    // Smooth heading drift — small random turn each tick gives an organic look.
    this.heading += (Math.random() - 0.5) * 2 * CONFIG.organismTurnRate;

    // Move. CONFIG.organismMaxSpeed is per-frame at 60fps; rescale to dt.
    const stepScale = dtSec * CONFIG.targetFps;
    this.x += Math.cos(this.heading) * this.speed * stepScale;
    this.y += Math.sin(this.heading) * this.speed * stepScale;

    // Bounce off world bounds. Reflecting the heading keeps motion natural and
    // prevents organisms from getting stuck against the walls.
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    else if (this.x > world.width) { this.x = world.width; this.heading = Math.PI - this.heading; }
    if (this.y < 0) { this.y = 0; this.heading = -this.heading; }
    else if (this.y > world.height) { this.y = world.height; this.heading = -this.heading; }

    // Eat any food within reach.
    const food = world.nearestFood(this.x, this.y, CONFIG.organismEatRadius);
    if (food) {
      food.eaten = true;
      this.energy = Math.min(CONFIG.organismMaxEnergy, this.energy + CONFIG.foodEnergy);
    }

    // Energy decay scales mildly with normalized speed.
    const speedNorm = this.speed / CONFIG.organismMaxSpeed;
    const decay = CONFIG.organismEnergyDecayPerSec
      * (1 + (CONFIG.organismEnergyDecayMoveMult - 1) * speedNorm);
    this.energy -= decay * dtSec;

    if (this.energy <= 0) {
      this.alive = false;
      this.causeOfDeath = 'starvation';
      return;
    }
    if (this.ageSec >= CONFIG.organismMaxAgeSec) {
      this.alive = false;
      this.causeOfDeath = 'age';
    }
  }
}
