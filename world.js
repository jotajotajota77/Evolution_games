import { CONFIG } from './config.js';
import { Organism } from './organism.js';
import { Lineage } from './lineage.js';
import { sampleInCircle } from './house.js';

// A pellet of food. Each one stores the energy it grants — set at spawn-time
// by the region that produced it (open world, house zone, or non-house zone).
function makeFood(x, y, energy) {
  return { x, y, eaten: false, phase: Math.random() * Math.PI * 2, energy };
}

// Per-region food spawn — works for both houses and non-house zones since
// both expose .x .y .radius .zone.{foodDensity,foodEnergy} .foodSpawnAccumulator.
function spawnFoodInRegions(world, regions, dtSec) {
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const rate = r.zone.foodDensity * (r.area() / 10000);
    r.foodSpawnAccumulator += rate * dtSec;
    while (r.foodSpawnAccumulator >= 1 && world.food.length < CONFIG.foodMaxCount) {
      const pt = sampleInCircle(r.x, r.y, r.radius * 0.97);
      world.food.push(makeFood(pt.x, pt.y, r.zone.foodEnergy));
      r.foodSpawnAccumulator -= 1;
    }
    if (world.food.length >= CONFIG.foodMaxCount) r.foodSpawnAccumulator = 0;
  }
}

// Shared logic: any region (house or zone) the organism's lineage isn't
// allowed into deflects it back to the perimeter and costs a little energy.
function bounceFromList(org, regions) {
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (r.isAllowed(org.lineageId)) continue;
    const dx = org.x - r.x;
    const dy = org.y - r.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= r.radius * r.radius) continue;
    const dist = Math.sqrt(distSq) || 0.0001;
    const push = (r.radius - dist) + 0.5;
    org.x += (dx / dist) * push;
    org.y += (dy / dist) * push;
    org.heading = Math.atan2(dy, dx);
    org.energy -= CONFIG.barrierHitEnergyCost;
  }
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
    this.zones = [];                  // non-house zones (phase 5)

    this.tickSec = CONFIG.startAtNoon ? CONFIG.dayLengthSec / 2 : 0;
    this.foodSpawnAccumulator = 0;
    this.deathsByCause = { starvation: 0, age: 0 };
    this.totalBirths = 0;
    this.maxGenerationSeen = 0;

    // Day/night state. Recomputed every tick from tickSec so sub-stepping
    // and speed multipliers don't drift. daylight is a smooth 0..1 signal:
    //   midnight = 0, noon = 1, with cosine easing through dawn/dusk.
    this.dayPhase = 0;
    this.dayCount = 1;
    this.daylight = 1;
    this._recomputeDayCycle();
  }

  _recomputeDayCycle() {
    const len = CONFIG.dayLengthSec;
    this.dayPhase = (this.tickSec % len) / len;
    this.dayCount = Math.floor(this.tickSec / len) + 1;
    this.daylight = (1 - Math.cos(2 * Math.PI * this.dayPhase)) / 2;
  }

  // Sky tint at the current moment, lerped between worldBgNight and worldBgDay.
  // Used by the renderer's per-frame trail-fade overlay so the canvas slowly
  // drifts toward the right colour as time passes.
  currentBgColor() {
    const d = this.daylight;
    const day = CONFIG.worldBgDay;
    const night = CONFIG.worldBgNight;
    return [
      night[0] + (day[0] - night[0]) * d,
      night[1] + (day[1] - night[1]) * d,
      night[2] + (day[2] - night[2]) * d,
    ];
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
    for (const z of this.zones) z.foodSpawnAccumulator = 0;
    this.tickSec = CONFIG.startAtNoon ? CONFIG.dayLengthSec / 2 : 0;
    this._recomputeDayCycle();
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

  addZone(zone) {
    this.zones.push(zone);
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

  zoneContaining(x, y) {
    for (let i = 0; i < this.zones.length; i++) {
      if (this.zones[i].contains(x, y)) return this.zones[i];
    }
    return null;
  }

  // Pushes an organism out of any zone whose access list excludes its lineage.
  // Called from organism.update after movement; the barrier is enforced as a
  // hard collision (project to perimeter, deflect heading outward, small
  // energy penalty).
  enforceZoneAccess(org) {
    bounceFromList(org, this.houses);
    bounceFromList(org, this.zones);
  }

  // Decay multiplier at a point. With overlapping regions, the last writer
  // wins (houses first, then zones — zones overlay houses on collision).
  zoneDecayMultiplierAt(x, y) {
    let mult = 1;
    for (let i = 0; i < this.houses.length; i++) {
      if (this.houses[i].contains(x, y)) mult = this.houses[i].zone.decayMultiplier;
    }
    for (let i = 0; i < this.zones.length; i++) {
      if (this.zones[i].contains(x, y)) mult = this.zones[i].zone.decayMultiplier;
    }
    return mult;
  }

  // dtSec is already speed-scaled by the caller.
  update(dtSec) {
    this.tickSec += dtSec;
    this._recomputeDayCycle();

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
    spawnFoodInRegions(this, this.houses, dtSec);
    spawnFoodInRegions(this, this.zones, dtSec);

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
      if (this.houseContaining(x, y)) continue;
      if (this.zoneContaining(x, y)) continue;
      return { x, y };
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
