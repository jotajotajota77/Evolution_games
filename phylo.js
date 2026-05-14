import { CONFIG } from './config.js';
import { deriveChildName } from './names.js';

let nextSpeciesId = 1;

export function ensureNextSpeciesId(min) {
  if (min >= nextSpeciesId) nextSpeciesId = min + 1;
}

// A node in the phylogenetic tree. Every lineage starts with one "root"
// species; speciation events spawn child species. In classic mode the
// parent's diedTick is set on a split; in budding mode the parent stays
// alive and just buds off one child.
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

// Owner of the species list + the speciation rule. The world runs one Phylo
// per visualisation mode in parallel ("classic" vs "budding").
//
// Modes
//   classic  — split spawns 2 children with new names; the parent's
//              diedTick is set and its organisms are repartitioned between
//              the children. Standard cladistic representation.
//   budding  — split spawns 1 child for the more-diverged cluster; the
//              parent stays alive with the remaining organisms and keeps
//              its name. Matches the v1.22 metaphor where the mother's
//              genome is preserved.
//
// Organisms carry one speciesId per mode (organism.speciesId for classic,
// organism.budSpeciesId for budding). Phylo.idField points at the right
// field so refresh + speciate touch the right column.
export class Phylo {
  constructor(mode = 'classic', opts = {}) {
    this.mode = mode;
    // v1.53: idField and entityList are overridable so the same machinery
    // tracks predators (entityList = w.predators, idField = predSpeciesId).
    // Defaults preserve organism behaviour for existing callers.
    this.idField = opts.idField || (mode === 'budding' ? 'budSpeciesId' : 'speciesId');
    this.entityList = opts.entityList || ((world) => world.organisms);
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

  _refreshPops(world) {
    for (let i = 0; i < this.species.length; i++) this.species[i].currentPop = 0;
    const ents = this.entityList(world);
    for (let i = 0; i < ents.length; i++) {
      const s = this.getById(ents[i][this.idField]);
      if (s) s.currentPop++;
    }
    for (const s of this.species) {
      if (s.currentPop > s.peakPop) s.peakPop = s.currentPop;
      if (s.currentPop === 0 && s.diedTick == null && s.peakPop > 0) {
        s.diedTick = world.tickSec;
      }
    }
  }

  _maybeSpeciate(world) {
    const groups = new Map();
    const ents = this.entityList(world);
    for (const o of ents) {
      const sid = o[this.idField];
      if (sid == null) continue;
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push(o);
    }
    const sids = [...groups.keys()];
    for (const sid of sids) {
      const orgs = groups.get(sid);
      if (orgs.length < CONFIG.phyloMinChildPop * 2) continue;
      const species = this.getById(sid);
      if (!species) continue;
      if (world.tickSec - species.bornTick < CONFIG.phyloMinAgeSec) continue;

      const stats = this._driftStats(orgs);
      if (stats.totalStd < CONFIG.phyloSplitStdThreshold) continue;

      const split = this._partition(orgs, stats);
      if (!split) continue;

      if (this.mode === 'budding') this._budOff(species, split, world);
      else                          this._splitClassic(species, split, world);
    }
  }

  // Mean + per-axis variance + winning split axis. Used by both modes.
  _driftStats(orgs) {
    let mx = 0, my = 0, mz = 0;
    for (const o of orgs) {
      mx += o.colorDrift[0]; my += o.colorDrift[1]; mz += o.colorDrift[2];
    }
    mx /= orgs.length; my /= orgs.length; mz /= orgs.length;
    let vR = 0, vG = 0, vB = 0;
    for (const o of orgs) {
      const dx = o.colorDrift[0] - mx;
      const dy = o.colorDrift[1] - my;
      const dz = o.colorDrift[2] - mz;
      vR += dx * dx; vG += dy * dy; vB += dz * dz;
    }
    vR /= orgs.length; vG /= orgs.length; vB /= orgs.length;
    let axis = 0;
    let maxV = vR;
    if (vG > maxV) { axis = 1; maxV = vG; }
    if (vB > maxV) { axis = 2; }
    return {
      mean: [mx, my, mz],
      axis,
      splitVal: [mx, my, mz][axis],
      totalStd: Math.sqrt(vR + vG + vB),
    };
  }

  _partition(orgs, stats) {
    const above = [], below = [];
    for (const o of orgs) {
      if (o.colorDrift[stats.axis] > stats.splitVal) above.push(o);
      else                                            below.push(o);
    }
    const min = CONFIG.phyloMinChildPop;
    if (above.length < min || below.length < min) return null;
    return { above, below, axis: stats.axis };
  }

  _splitClassic(parent, split, world) {
    // Label one half "staying" (low |drift|, closer to lineage base) and
    // the other "branching" (high |drift|). Both halves form new species,
    // but the seeds are deterministic so the matriarchal tree picks the
    // same branching name from the same event.
    let absAbove = 0, absBelow = 0;
    for (const o of split.above) absAbove += Math.abs(o.colorDrift[split.axis]);
    for (const o of split.below) absBelow += Math.abs(o.colorDrift[split.axis]);
    absAbove /= split.above.length;
    absBelow /= split.below.length;
    const staying   = absAbove < absBelow ? split.above : split.below;
    const branching = absAbove < absBelow ? split.below : split.above;

    // Prefer the lineage palette; fall back to the parent species' own
    // colour (used by entities like predators that aren't registered in
    // world.lineages but still have a colour-carrying root species).
    const lin = world.lineages.get(parent.lineageId);
    const base = lin ? lin.color : parent.color;
    const tickKey = Math.round(world.tickSec * 10);
    const seedBranch = `${parent.lineageId}-${tickKey}-branching`;
    const seedStay   = `${parent.lineageId}-${tickKey}-staying`;

    const childStay = this._makeChild(parent, staying, base, world.tickSec,
      deriveChildName(parent.name, seedStay));
    const childBranch = this._makeChild(parent, branching, base, world.tickSec,
      deriveChildName(parent.name, seedBranch));

    for (const o of staying)   o[this.idField] = childStay.id;
    for (const o of branching) o[this.idField] = childBranch.id;
    parent.diedTick = world.tickSec;
  }

  _budOff(parent, split, world) {
    // The more-diverged cluster (whose drift on the split axis is farther
    // from the lineage's neutral 0) buds off into a new species; the
    // closer-to-base cluster stays attached to the mother lineage. The
    // parent never dies during a budding split.
    let absA = 0, absB = 0;
    for (const o of split.above) absA += Math.abs(o.colorDrift[split.axis]);
    for (const o of split.below) absB += Math.abs(o.colorDrift[split.axis]);
    absA /= split.above.length;
    absB /= split.below.length;
    const branching = absA >= absB ? split.above : split.below;
    // Prefer the lineage palette; fall back to the parent species' own
    // colour (used by entities like predators that aren't registered in
    // world.lineages but still have a colour-carrying root species).
    const lin = world.lineages.get(parent.lineageId);
    const base = lin ? lin.color : parent.color;
    // Same seed shape as cladistic's branching child — names match across
    // trees for the same speciation event.
    const tickKey = Math.round(world.tickSec * 10);
    const seedBranch = `${parent.lineageId}-${tickKey}-branching`;
    const child = this._makeChild(parent, branching, base, world.tickSec,
      deriveChildName(parent.name, seedBranch));
    for (const o of branching) o[this.idField] = child.id;
    // staying-half organisms keep parent's id implicitly.
  }

  _makeChild(parent, orgs, base, tickSec, overrideName) {
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
    const name = overrideName ?? deriveChildName(parent.name);
    const s = new PhyloSpecies(
      nextSpeciesId++, parent.id, parent.lineageId, color, tickSec, name,
    );
    s.currentPop = orgs.length;
    s.peakPop = orgs.length;
    this.species.push(s);
    return s;
  }
}

function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
