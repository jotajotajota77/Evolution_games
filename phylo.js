import { CONFIG } from './config.js';
import { deriveChildName } from './names.js';

let nextSpeciesId = 1;

export function ensureNextSpeciesId(min) {
  if (min >= nextSpeciesId) nextSpeciesId = min + 1;
}

// A node in the phylogenetic tree. Every lineage starts with one "root"
// species; speciation events spawn two child species and mark the parent's
// diedTick (its living organisms get reassigned to children).
export class PhyloSpecies {
  constructor(id, parentId, lineageId, color, bornTick, name = '?') {
    this.id = id;
    this.parentId = parentId;
    this.lineageId = lineageId;
    this.color = [color[0], color[1], color[2]];
    this.bornTick = bornTick;
    this.diedTick = null;
    this.peakPop = 0;
    this.currentPop = 0;
    this.name = name;
  }
}

// Owner of the species list + the speciation rule. The world calls
// phylo.tick(world, dtSec) inside its own update; speciation only runs at
// CONFIG.phyloCheckIntervalSec cadence to keep cost bounded.
export class Phylo {
  constructor() {
    this.species = [];
    this.lineageRoots = new Map();   // lineageId → root speciesId
    this._sinceLastCheck = 0;
  }

  initLineageRoot(lineage, tickSec) {
    const s = new PhyloSpecies(nextSpeciesId++, null, lineage.id, lineage.color, tickSec, lineage.name);
    this.species.push(s);
    this.lineageRoots.set(lineage.id, s.id);
    return s.id;
  }

  getById(id) {
    for (let i = 0; i < this.species.length; i++) {
      if (this.species[i].id === id) return this.species[i];
    }
    return null;
  }

  tick(world, dtSec) {
    this._sinceLastCheck += dtSec;
    if (this._sinceLastCheck < CONFIG.phyloCheckIntervalSec) return;
    this._sinceLastCheck = 0;
    this._refreshPops(world);
    this._maybeSpeciate(world);
  }

  // Refresh currentPop / peakPop / diedTick by scanning organisms.
  _refreshPops(world) {
    for (let i = 0; i < this.species.length; i++) this.species[i].currentPop = 0;
    for (let i = 0; i < world.organisms.length; i++) {
      const s = this.getById(world.organisms[i].speciesId);
      if (s) s.currentPop++;
    }
    for (const s of this.species) {
      if (s.currentPop > s.peakPop) s.peakPop = s.currentPop;
      if (s.currentPop === 0 && s.diedTick == null && s.peakPop > 0) {
        s.diedTick = world.tickSec;
      }
    }
  }

  // Iterate each live species, check if its drift distribution is broad
  // enough to justify a split, and if so spawn two children along the
  // principal (max-variance) axis.
  _maybeSpeciate(world) {
    const groups = new Map();
    for (const o of world.organisms) {
      if (o.speciesId == null) continue;
      if (!groups.has(o.speciesId)) groups.set(o.speciesId, []);
      groups.get(o.speciesId).push(o);
    }

    // Snapshot keys — we mutate this.species inside the loop.
    const sids = [...groups.keys()];
    for (const sid of sids) {
      const orgs = groups.get(sid);
      if (orgs.length < CONFIG.phyloMinChildPop * 2) continue;
      const species = this.getById(sid);
      if (!species) continue;
      if (world.tickSec - species.bornTick < CONFIG.phyloMinAgeSec) continue;

      // Mean drift.
      let mx = 0, my = 0, mz = 0;
      for (const o of orgs) {
        mx += o.colorDrift[0]; my += o.colorDrift[1]; mz += o.colorDrift[2];
      }
      mx /= orgs.length; my /= orgs.length; mz /= orgs.length;

      // Per-axis variance and total stddev.
      let vR = 0, vG = 0, vB = 0;
      for (const o of orgs) {
        const dx = o.colorDrift[0] - mx;
        const dy = o.colorDrift[1] - my;
        const dz = o.colorDrift[2] - mz;
        vR += dx * dx; vG += dy * dy; vB += dz * dz;
      }
      vR /= orgs.length; vG /= orgs.length; vB /= orgs.length;
      const totalStd = Math.sqrt(vR + vG + vB);
      if (totalStd < CONFIG.phyloSplitStdThreshold) continue;

      // Split on the channel with the most variance.
      let axis = 0;
      let maxV = vR;
      if (vG > maxV) { axis = 1; maxV = vG; }
      if (vB > maxV) { axis = 2; }
      const splitVal = [mx, my, mz][axis];

      const above = [], below = [];
      for (const o of orgs) {
        if (o.colorDrift[axis] > splitVal) above.push(o);
        else                                below.push(o);
      }
      const min = CONFIG.phyloMinChildPop;
      if (above.length < min || below.length < min) continue;

      const lin = world.lineages.get(species.lineageId);
      const base = lin ? lin.color : [200, 200, 220];

      const childA = this._makeChild(species, above, base, world.tickSec);
      const childB = this._makeChild(species, below, base, world.tickSec);

      for (const o of above) o.speciesId = childA.id;
      for (const o of below) o.speciesId = childB.id;

      species.diedTick = world.tickSec;
    }
  }

  _makeChild(parent, orgs, base, tickSec) {
    let cx = 0, cy = 0, cz = 0;
    for (const o of orgs) {
      cx += o.colorDrift[0]; cy += o.colorDrift[1]; cz += o.colorDrift[2];
    }
    cx /= orgs.length; cy /= orgs.length; cz /= orgs.length;
    const color = [
      clamp255(base[0] + cx),
      clamp255(base[1] + cy),
      clamp255(base[2] + cz),
    ];
    const s = new PhyloSpecies(
      nextSpeciesId++, parent.id, parent.lineageId, color, tickSec,
      deriveChildName(parent.name),
    );
    s.currentPop = orgs.length;
    s.peakPop = orgs.length;
    this.species.push(s);
    return s;
  }
}

function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
