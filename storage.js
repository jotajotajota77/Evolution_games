import { World } from './world.js';
import { Lineage, ensureNextLineageId } from './lineage.js';
import { House, ensureNextHouseId } from './house.js';
import { Zone, ensureNextZoneId } from './zone.js';
import { Barrier, ensureNextBarrierId } from './barrier.js';
import { Predator, ensureNextPredatorId } from './predator.js';
import { Organism } from './organism.js';
import { NeuralNet } from './neuralnet.js';

const STORAGE_KEY = 'evolution_save_v1';

export function hasSavedWorld() {
  try { return localStorage.getItem(STORAGE_KEY) != null; }
  catch (_) { return false; }
}

export function saveWorld(world) {
  try {
    const payload = JSON.stringify(serialize(world));
    localStorage.setItem(STORAGE_KEY, payload);
    return { ok: true, bytes: payload.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function loadWorld() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch (e) {
    console.error('load failed:', e);
    return null;
  }
}

export function clearSavedWorld() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
}

// --- Snapshot shape ---
// Everything is plain JSON-safe data. Float32Array weights become regular
// arrays; Sets become arrays. Class instances are rebuilt by deserialize().
function serialize(w) {
  return {
    width: w.width,
    height: w.height,
    tickSec: w.tickSec,
    deathsByCause: { ...w.deathsByCause },
    totalBirths: w.totalBirths,
    maxGenerationSeen: w.maxGenerationSeen,
    lineages: [...w.lineages.values()].map((l) => ({
      id: l.id, name: l.name, color: [...l.color], houseId: l.houseId,
    })),
    houses: w.houses.map((h) => ({
      id: h.id, x: h.x, y: h.y, radius: h.radius, lineageId: h.lineageId,
      zone: { ...h.zone },
      barrier: { ...h.barrier },
      allowedLineages: [...h.allowedLineages],
    })),
    zones: w.zones.map((z) => ({
      id: z.id, x: z.x, y: z.y, radius: z.radius, color: [...z.color],
      zone: { ...z.zone },
      allowedLineages: [...z.allowedLineages],
    })),
    barriers: w.barriers.map((b) => ({
      id: b.id,
      points: b.points.map((p) => ({ x: p.x, y: p.y })),
      thickness: b.thickness,
      color: [...b.color],
      allowedLineages: [...b.allowedLineages],
      transparentFromSideA: b.transparentFromSideA,
      transparentFromSideB: b.transparentFromSideB,
    })),
    organisms: w.organisms.map((o) => ({
      x: o.x, y: o.y, heading: o.heading, currentSpeed: o.currentSpeed,
      energy: o.energy, ageSec: o.ageSec, lineageId: o.lineageId,
      generation: o.generation,
      colorDrift: o.colorDrift ? [...o.colorDrift] : [0, 0, 0],
      brain: Array.from(o.brain.weights),
    })),
    predators: w.predators.map((p) => ({
      id: p.id, x: p.x, y: p.y, heading: p.heading, currentSpeed: p.currentSpeed,
      energy: p.energy, ageSec: p.ageSec,
    })),
  };
}

function deserialize(d) {
  const w = new World(d.width, d.height);
  // The constructor seeds a default lineage; replace everything wholesale.
  w.lineages.clear();
  w.houses.length = 0;
  w.zones.length = 0;
  w.barriers.length = 0;
  w.organisms.length = 0;
  w.predators.length = 0;
  w.food.length = 0;

  w.tickSec = d.tickSec ?? 0;
  Object.assign(w.deathsByCause, d.deathsByCause || {});
  w.totalBirths = d.totalBirths || 0;
  w.maxGenerationSeen = d.maxGenerationSeen || 0;
  w._recomputeDayCycle();

  let maxLineageId = 0;
  for (const ld of d.lineages || []) {
    const lin = new Lineage(ld.id, ld.name, ld.color);
    lin.houseId = ld.houseId ?? null;
    w.lineages.set(lin.id, lin);
    if (ld.id > maxLineageId) maxLineageId = ld.id;
  }
  ensureNextLineageId(maxLineageId + 1);

  let maxHouseId = 0;
  for (const hd of d.houses || []) {
    const h = new House(hd.x, hd.y, hd.radius, hd.lineageId, hd.zone, hd.barrier, hd.allowedLineages);
    h.id = hd.id;
    w.houses.push(h);
    const lin = w.lineages.get(hd.lineageId);
    if (lin) { lin.houseId = h.id; lin.house = h; }
    if (hd.id > maxHouseId) maxHouseId = hd.id;
  }
  ensureNextHouseId(maxHouseId + 1);

  let maxZoneId = 0;
  for (const zd of d.zones || []) {
    const z = new Zone(zd.x, zd.y, zd.radius, zd.color, zd.zone, zd.allowedLineages);
    z.id = zd.id;
    w.zones.push(z);
    if (zd.id > maxZoneId) maxZoneId = zd.id;
  }
  ensureNextZoneId(maxZoneId + 1);

  let maxBarrierId = 0;
  for (const bd of d.barriers || []) {
    const b = new Barrier(bd.points, {
      thickness: bd.thickness,
      color: bd.color,
      allowedLineages: bd.allowedLineages,
      transparentFromSideA: bd.transparentFromSideA,
      transparentFromSideB: bd.transparentFromSideB,
    });
    b.id = bd.id;
    w.barriers.push(b);
    if (bd.id > maxBarrierId) maxBarrierId = bd.id;
  }
  ensureNextBarrierId(maxBarrierId + 1);

  for (const od of d.organisms || []) {
    const brain = new NeuralNet(undefined, new Float32Array(od.brain));
    const o = new Organism(od.x, od.y, od.lineageId, brain, od.colorDrift);
    o.heading = od.heading;
    o.currentSpeed = od.currentSpeed;
    o.energy = od.energy;
    o.ageSec = od.ageSec;
    o.generation = od.generation;
    w.organisms.push(o);
  }

  let maxPredatorId = 0;
  for (const pd of d.predators || []) {
    const p = new Predator(pd.x, pd.y);
    if (pd.id != null) { p.id = pd.id; if (pd.id > maxPredatorId) maxPredatorId = pd.id; }
    p.heading = pd.heading;
    p.currentSpeed = pd.currentSpeed;
    p.energy = pd.energy;
    p.ageSec = pd.ageSec;
    w.predators.push(p);
  }
  ensureNextPredatorId(maxPredatorId + 1);

  return w;
}
