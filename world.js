import { CONFIG } from './config.js';
import { Organism } from './organism.js';
import { Lineage } from './lineage.js';
import { sampleInCircle } from './house.js';

// A pellet of food. Each one stores the energy it grants — set at spawn-time
// by the region that produced it (open world or a specific house zone).
function makeFood(x, y, energy) {
  return { x, y, eaten: false, phase: Math.random() * Math.PI * 2, energy };
}

export class World {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.organisms = [];
    this.food = [];

    // Lineages keyed by id. The default lineage seeds the page when it loads
    // so visitors see motion immediately, even before placing any houses.
    this.lineages = new Map();
    const def = new Lineage(
      CONFIG.defaultLineage.id,
      CONFIG.defaultLineage.name,
      CONFIG.defaultLineage.color,
    );
    this.lineages.set(def.id, def);

    this.houses = [];

    this.tickSec = 0;
    this.foodSpawnAccumulator = 0;
    this.deathsByCause = { starvation: 0, age: 0 };
    this.totalBirths = 0;
    this.maxGenerationSeen = 0;
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    for (const o of this.organisms) {
      o.x = Math.min(Math.max(o.x, 0), w);
      o.y = Math.min(Math.max(o.y, 0), h);
    }
    this.food = this.food.filter(f => f.x >= 0 && f.x <= w && f.y >= 0 && f.y <= h);
  }

  seed(count = CONFIG.initialPopulation) {
    // Default-lineage starter pop. New user lineages spawn via addHouse/seedFounders.
    for (let i = 0; i < count; i++) {
      this.organisms.push(new Organism(
        Math.random() * this.width,
        Math.random() * this.height,
        CONFIG.defaultLineage.id,
      ));
    }
    const initialFood = Math.min(CONFIG.foodMaxCount * 0.4, 200);
    for (let i = 0; i < initialFood; i++) {
      this.food.push(makeFood(
        Math.random() * this.width,
        Math.random() * this.height,
        CONFIG.foodEnergy,
      ));
    }
  }

  reset() {
    this.organisms.length = 0;
    this.food.length = 0;
    // Houses + lineages are part of the configured world, so they survive reset.
    // Only living state is cleared. Reset accumulators on houses so they don't
    // burst-spawn after pause-resume.
    for (const h of this.houses) h.foodSpawnAccumulator = 0;
    this.tickSec = 0;
    this.foodSpawnAccumulator = 0;
    this.deathsByCause = { starvation: 0, age: 0 };
    this.totalBirths = 0;
    this.maxGenerationSeen = 0;
    // Re-seed default lineage so the world isn't empty after reset.
    this.seed();
    // Re-seed each user lineage from their house.
    for (const h of this.houses) this.seedFoundersForHouse(h, CONFIG.houseDefaults.founders);
  }

  addLineage(lineage) {
    this.lineages.set(lineage.id, lineage);
  }

  addHouse(house) {
    this.houses.push(house);
    const lin = this.lineages.get(house.lineageId);
    if (lin) {
      lin.houseId = house.id;
      lin.house = house;
    }
  }

  // Spawns N founders for a house, with random brains, inside its zone.
  seedFoundersForHouse(house, count) {
    for (let i = 0; i < count; i++) {
      const pt = sampleInCircle(house.x, house.y, house.radius * 0.92);
      this.organisms.push(new Organism(pt.x, pt.y, house.lineageId));
    }
  }

  // Zone lookup: returns the first house (if any) containing the point.
  // Used by sensors and decay modulation. Linear scan — fine for <20 houses.
  houseContaining(x, y) {
    for (let i = 0; i < this.houses.length; i++) {
      if (this.houses[i].contains(x, y)) return this.houses[i];
    }
    return null;
  }

  // Decay multiplier at a point. With overlapping zones the most recently
  // placed house wins (last writer); documented as the convention.
  zoneDecayMultiplierAt(x, y) {
    let mult = 1;
    for (let i = 0; i < this.houses.length; i++) {
      if (this.houses[i].contains(x, y)) mult = this.houses[i].zone.decayMultiplier;
    }
    return mult;
  }

  // dtSec is already speed-scaled by the caller.
  update(dtSec) {
    this.tickSec += dtSec;

    // --- Food spawn ---
    // Open-area pellets: try to land in non-house space. Failing 8 times means
    // the world is heavily covered; cap the accumulator to avoid bursts later.
    this.foodSpawnAccumulator += CONFIG.foodSpawnRatePerSec * dtSec;
    while (this.foodSpawnAccumulator >= 1 && this.food.length < CONFIG.foodMaxCount) {
      const pt = this.sampleOpenPoint();
      if (!pt) {
        this.foodSpawnAccumulator = Math.min(this.foodSpawnAccumulator, 1);
        break;
      }
      this.food.push(makeFood(pt.x, pt.y, CONFIG.foodEnergy));
      this.foodSpawnAccumulator -= 1;
    }
    if (this.food.length >= CONFIG.foodMaxCount) this.foodSpawnAccumulator = 0;

    // Per-house pellets: density is in spawns/sec per 100x100-px tile.
    for (let i = 0; i < this.houses.length; i++) {
      const h = this.houses[i];
      const rate = h.zone.foodDensity * (h.area() / 10000);
      h.foodSpawnAccumulator += rate * dtSec;
      while (h.foodSpawnAccumulator >= 1 && this.food.length < CONFIG.foodMaxCount) {
        const pt = sampleInCircle(h.x, h.y, h.radius * 0.97);
        this.food.push(makeFood(pt.x, pt.y, h.zone.foodEnergy));
        h.foodSpawnAccumulator -= 1;
      }
      if (this.food.length >= CONFIG.foodMaxCount) h.foodSpawnAccumulator = 0;
    }

    // --- Organisms ---
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
        } else if (o.causeOfDeath && this.deathsByCause[o.causeOfDeath] !== undefined) {
          this.deathsByCause[o.causeOfDeath]++;
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

  sampleOpenPoint() {
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      if (!this.houseContaining(x, y)) return { x, y };
    }
    return null;
  }

  // Nearest food within `radius`. Linear scan; spatial hashing arrives in phase 8.
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
