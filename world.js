import { CONFIG } from './config.js';
import { Organism } from './organism.js';

// One pellet of food. Lightweight POJO — no class to keep arrays tight.
function makeFood(x, y) {
  return { x, y, eaten: false, phase: Math.random() * Math.PI * 2 };
}

export class World {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.organisms = [];
    this.food = [];
    this.tickSec = 0;                 // simulated seconds (scaled by speed)
    this.foodSpawnAccumulator = 0;
    this.deathsByCause = { starvation: 0, age: 0 };
    this.totalBirths = 0;             // cumulative births since last reset
    this.maxGenerationSeen = 0;
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    // Clamp existing entities into the new bounds.
    for (const o of this.organisms) {
      o.x = Math.min(Math.max(o.x, 0), w);
      o.y = Math.min(Math.max(o.y, 0), h);
    }
    this.food = this.food.filter(f => f.x >= 0 && f.x <= w && f.y >= 0 && f.y <= h);
  }

  seed(count = CONFIG.initialPopulation) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      this.organisms.push(new Organism(x, y, CONFIG.defaultLineage.id));
    }
    // Pre-seed a starting food field so early frames don't look empty.
    const initialFood = Math.min(CONFIG.foodMaxCount * 0.4, 200);
    for (let i = 0; i < initialFood; i++) {
      this.food.push(makeFood(Math.random() * this.width, Math.random() * this.height));
    }
  }

  reset() {
    this.organisms.length = 0;
    this.food.length = 0;
    this.tickSec = 0;
    this.foodSpawnAccumulator = 0;
    this.deathsByCause = { starvation: 0, age: 0 };
    this.totalBirths = 0;
    this.maxGenerationSeen = 0;
  }

  // dtSec is already speed-scaled by the caller.
  update(dtSec) {
    this.tickSec += dtSec;

    // Spawn food at the global uniform rate (phase 1 has no zones).
    this.foodSpawnAccumulator += CONFIG.foodSpawnRatePerSec * dtSec;
    while (this.foodSpawnAccumulator >= 1 && this.food.length < CONFIG.foodMaxCount) {
      this.food.push(makeFood(Math.random() * this.width, Math.random() * this.height));
      this.foodSpawnAccumulator -= 1;
    }
    // Cap accumulator if we hit the food ceiling — prevents huge bursts on resume.
    if (this.food.length >= CONFIG.foodMaxCount) this.foodSpawnAccumulator = 0;

    // Tick organisms and collect births. Spawning into a side array keeps the
    // for-loop bounds stable and lets us enforce the population cap globally.
    const newBorns = [];
    const cap = CONFIG.maxPopulation;
    for (let i = 0; i < this.organisms.length; i++) {
      const o = this.organisms[i];
      o.update(dtSec, this);
      if (o.wantsToReproduce && this.organisms.length + newBorns.length < cap) {
        const child = o.spawnChild();
        newBorns.push(child);
        if (child.generation > this.maxGenerationSeen) {
          this.maxGenerationSeen = child.generation;
        }
      }
    }
    if (newBorns.length) {
      this.organisms.push(...newBorns);
      this.totalBirths += newBorns.length;
    }

    // Cull dead organisms in a single sweep.
    if (this.organisms.length) {
      const alive = [];
      for (const o of this.organisms) {
        if (o.alive) {
          alive.push(o);
        } else {
          if (o.causeOfDeath && this.deathsByCause[o.causeOfDeath] !== undefined) {
            this.deathsByCause[o.causeOfDeath]++;
          }
        }
      }
      this.organisms = alive;
    }

    // Sweep eaten food.
    if (this.food.length) {
      const remaining = [];
      for (const f of this.food) if (!f.eaten) remaining.push(f);
      this.food = remaining;
    }
  }

  // Nearest food within `radius`. Phase 1 uses linear scan; spatial hashing arrives in phase 8.
  nearestFood(x, y, radius) {
    let best = null;
    let bestD2 = radius * radius;
    for (const f of this.food) {
      if (f.eaten) continue;
      const dx = f.x - x, dy = f.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = f; }
    }
    return best;
  }
}
