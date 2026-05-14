import { CONFIG } from './config.js';
import { World } from './world.js';
import {
  attachP5, rebuildVignette, drawTrailFade,
  drawFood, drawOrganisms, drawHouses, drawZones, drawBarriers, drawPredators,
  drawPoisons, drawOrganismHighlight, drawPlacementPreview,
  drawVignette, drawNightTint, paintBackground,
} from './renderer.js';
import { createLineage, suggestNextLineageDefaults } from './lineage.js';
import { House } from './house.js';
import { Zone } from './zone.js';
import { Barrier } from './barrier.js';
import {
  setTool, getTool, isModalOpen, onPlaceHouse, onPlaceZone, onPlaceBarrier,
  onErase, onEdit, onToolChange,
  onMouseDown, onMouseMove, onMouseUp, getDrag,
} from './tools.js';
import { showHouseModal, showZoneModal, showBarrierModal } from './ui.js';
import { FloatingWindow } from './windows.js';
import { saveWorld, loadWorld, hasSavedWorld } from './storage.js';

// ---- runtime state ----
const state = {
  world: null,
  paused: false,
  speedIdx: CONFIG.defaultSpeedIdx,
  lastFrameMs: 0,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
  canvasEl: null,
  // "Follow best" now just highlights the oldest alive organism with a
  // pulsing ring — no camera translate. Re-picked each render so the marker
  // jumps to the next-oldest when the current target dies.
  followBest: false,
};

// ---- p5 sketch ----
const sketch = (p) => {
  p.setup = () => {
    const host = document.getElementById('canvas-host');
    const w = host.clientWidth;
    const h = host.clientHeight;
    const cnv = p.createCanvas(w, h);
    cnv.parent(host);
    attachP5(p);
    rebuildVignette(w, h);
    paintBackground();

    state.world = new World(w, h);
    state.world.seed();
    state.canvasEl = cnv.elt;

    setupCanvasPointerEvents(cnv.elt);

    state.lastFrameMs = performance.now();
    p.frameRate(CONFIG.targetFps);

    const refit = () => {
      const nw = host.clientWidth;
      const nh = host.clientHeight;
      if (nw === p.width && nh === p.height) return;
      p.resizeCanvas(nw, nh);
      rebuildVignette(nw, nh);
      paintBackground();
      state.world.resize(nw, nh);
    };
    window.addEventListener('resize', refit);
    // Mobile browsers don't always fire window.resize when the URL bar
    // collapses or the visible viewport changes (notch / cutout). Listen
    // to visualViewport.resize too so the canvas always fills.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refit);
    }
  };

  p.draw = () => {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - state.lastFrameMs) / 1000);
    state.lastFrameMs = now;

    state.fpsAccum += realDt;
    state.fpsFrames += 1;
    if (state.fpsAccum >= 0.5) {
      state.fps = Math.round(state.fpsFrames / state.fpsAccum);
      state.fpsAccum = 0;
      state.fpsFrames = 0;
    }

    if (!state.paused) {
      const speed = CONFIG.speedSteps[state.speedIdx];
      // 0.5x runs in 1 sub-step (slower dt); high speeds split for stable
      // collisions. Cap raised to 16 so 20x stays per-sub-step ~1.25 frames.
      const subSteps = Math.min(16, Math.max(1, Math.ceil(speed)));
      const dt = (realDt * speed) / subSteps;
      for (let i = 0; i < subSteps; i++) state.world.update(dt);
    }

    drawTrailFade(state.world.currentBgColor());
    drawZones(state.world);
    drawHouses(state.world);
    drawBarriers(state.world);
    drawFood(state.world);
    drawPoisons(state.world);
    drawOrganisms(state.world);
    drawPredators(state.world);
    if (state.followBest) {
      drawOrganismHighlight(pickOldestOrganism(state.world));
    }
    drawPlacementPreview(getDrag());
    drawVignette();
    drawNightTint(state.world.daylight);
  };
};

// Pointer events attached directly to the canvas element. Native pointer
// capture means we keep receiving events even when the user drags outside
// the canvas — and unlike p5's window-level handlers, toolbar buttons get
// their own clicks without interference.
function setupCanvasPointerEvents(canvasEl) {
  let activePointer = null;

  const toCanvas = (e) => {
    const rect = canvasEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvasEl.addEventListener('pointerdown', (e) => {
    if (isModalOpen()) return;
    notifyUserActivity();
    const { x, y } = toCanvas(e);
    onMouseDown(x, y);
    activePointer = e.pointerId;
    canvasEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  canvasEl.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    const { x, y } = toCanvas(e);
    onMouseMove(x, y);
  });

  const finish = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const { x, y } = toCanvas(e);
    onMouseUp(x, y);
  };
  canvasEl.addEventListener('pointerup', finish);
  canvasEl.addEventListener('pointercancel', finish);
}

// ---- HUD ----
function updateHud() {
  const w = state.world;
  if (!w) return;
  document.getElementById('hud-pop').textContent = w.organisms.length;
  document.getElementById('hud-preds').textContent = w.predators.length;
  document.getElementById('hud-food').textContent = w.food.length;
  document.getElementById('hud-fps').textContent = state.fps;
  document.getElementById('hud-gen').textContent = w.maxGenerationSeen || 0;
  // In-game clock: phase 0 = midnight, phase 0.5 = noon. 1440 minutes per day.
  const totalMin = Math.floor((w.dayPhase || 0) * 1440);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  document.getElementById('hud-day').textContent = `d${w.dayCount || 1} ${hh}:${mm}`;
}

// ============================================================================
// Stats history — collected continuously, regardless of which charts are open.
// ============================================================================
const history = {
  labels: [],
  popByLin: new Map(),
  enByLin: new Map(),
  // Per-zone population over time. Keys: 'open' for organisms outside every
  // house, 'house-<id>' for each placed house. New keys are padded with
  // nulls so their line starts at the current time instead of the left edge.
  popByZone: new Map(),
  // Per-species population over time, one map per phylo tracking mode.
  // Keys are species ids (globally unique across both trees).
  popBySpecies: new Map(),
  popBySpeciesBud: new Map(),
};

// Same gate the renderer applies to decide whether a species shows up.
// Roots always pass; everything else needs a sustained peak AND, if extinct,
// enough lifespan that it isn't noise.
function speciesQualifies(s) {
  if (s.parentId == null) return true;
  if (s.peakPop < CONFIG.phyloMinDisplayPeakPop) return false;
  if (s.diedTick != null) {
    const lifespan = s.diedTick - s.bornTick;
    if (lifespan < CONFIG.phyloMinDisplayLifespanSec) return false;
  }
  return true;
}

// Ensures every qualifying species has a history bucket (padded with nulls
// up to the current frame), then pushes its currentPop. Extinct species
// keep producing 0 entries so the line touches the axis after death.
function trackSpeciesPop(phylo, map, padLen) {
  for (const s of phylo.species) {
    if (!speciesQualifies(s)) continue;
    if (!map.has(s.id)) map.set(s.id, new Array(padLen).fill(null));
  }
  for (const s of phylo.species) {
    const arr = map.get(s.id);
    if (!arr) continue;
    pushBoundedSeries(arr, s.currentPop);
  }
}

function pushBoundedSeries(arr, val) {
  arr.push(val);
  if (arr.length > CONFIG.statsHistoryPoints) arr.shift();
}

function resetHistoryBuffers() {
  history.labels.length = 0;
  history.popByLin.clear();
  history.enByLin.clear();
  history.popByZone.clear();
  history.popBySpecies.clear();
  history.popBySpeciesBud.clear();
}

function ensureLineageHistory(lin) {
  const padLen = history.labels.length;
  if (!history.popByLin.has(lin.id)) history.popByLin.set(lin.id, new Array(padLen).fill(null));
  if (!history.enByLin.has(lin.id))  history.enByLin.set(lin.id,  new Array(padLen).fill(null));
}

function tickHistory() {
  const w = state.world;
  if (!w) return;

  const t = Math.floor(w.tickSec);
  history.labels.push(`${t}s`);
  if (history.labels.length > CONFIG.statsHistoryPoints) history.labels.shift();

  const popMap = new Map();
  const sumE = new Map();
  for (const lin of w.lineages.values()) {
    ensureLineageHistory(lin);
    popMap.set(lin.id, 0);
    sumE.set(lin.id, 0);
  }
  for (const o of w.organisms) {
    popMap.set(o.lineageId, (popMap.get(o.lineageId) || 0) + 1);
    sumE.set(o.lineageId, (sumE.get(o.lineageId) || 0) + o.energy);
  }
  for (const lin of w.lineages.values()) {
    const pop = popMap.get(lin.id) || 0;
    const avgE = pop > 0 ? sumE.get(lin.id) / pop : 0;
    pushBoundedSeries(history.popByLin.get(lin.id), pop);
    pushBoundedSeries(history.enByLin.get(lin.id), avgE);
  }

  // Per-zone counts: "open" + one bucket per house. New keys padded with
  // nulls so their line starts at the current frame, not the chart's left edge.
  const padLen = history.labels.length - 1;
  if (!history.popByZone.has('open')) history.popByZone.set('open', new Array(padLen).fill(null));
  for (const h of w.houses) {
    const key = `house-${h.id}`;
    if (!history.popByZone.has(key)) history.popByZone.set(key, new Array(padLen).fill(null));
  }
  let openCount = 0;
  const houseCounts = new Map();
  for (const h of w.houses) houseCounts.set(h.id, 0);
  for (const o of w.organisms) {
    let placed = false;
    for (const h of w.houses) {
      if (h.contains(o.x, o.y)) {
        houseCounts.set(h.id, houseCounts.get(h.id) + 1);
        placed = true;
        break;
      }
    }
    if (!placed) openCount++;
  }
  pushBoundedSeries(history.popByZone.get('open'), openCount);
  for (const h of w.houses) {
    pushBoundedSeries(history.popByZone.get(`house-${h.id}`), houseCounts.get(h.id));
  }

  // Per-species pop (both trees). Each tree owns its own species so we
  // track them in separate maps keyed by globally-unique species id.
  trackSpeciesPop(w.phylo, history.popBySpecies, padLen);
  trackSpeciesPop(w.phyloBud, history.popBySpeciesBud, padLen);

  // Refresh open chart windows.
  for (const entry of openCharts.values()) {
    if (entry.update) entry.update();
  }
}

// ============================================================================
// On-demand chart factories. Each opens a FloatingWindow, builds a Chart.js
// instance inside its content area, and registers an updater for the history
// tick.
// ============================================================================
const openCharts = new Map();    // chartKey -> { window, chart, update }
let nextOffset = 0;              // cascade new windows so they don't overlap

function rgbToCss([r, g, b], a = 1) { return `rgba(${r}, ${g}, ${b}, ${a})`; }

function chartTheme() {
  return { color: '#8a8aa0', grid: '#1f1f2e', axis: '#2a2a3a' };
}

function makeLineChartCanvas(host) {
  const c = document.createElement('canvas');
  host.appendChild(c);
  const t = chartTheme();
  return new Chart(c, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.25 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
             grid: { color: t.grid, drawTicks: false }, border: { color: t.axis } },
        y: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
             grid: { color: t.grid, drawTicks: false }, border: { color: t.axis }, beginAtZero: true },
      },
    },
  });
}

function makeBarChartCanvas(host, stacked = true) {
  const c = document.createElement('canvas');
  host.appendChild(c);
  const t = chartTheme();
  return new Chart(c, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' } },
             grid: { display: false }, border: { color: t.axis }, stacked },
        y: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
             grid: { color: t.grid, drawTicks: false }, border: { color: t.axis }, stacked, beginAtZero: true },
      },
    },
  });
}

// Chart factory registry. Each entry returns the open() invocation params.
const chartFactories = {
  population: () => ({
    title: 'population',
    factory: (host) => {
      const chart = makeLineChartCanvas(host);
      const update = () => {
        chart.data.labels = history.labels;
        chart.data.datasets = [...state.world.lineages.values()].map((lin) => ({
          label: lin.name,
          data: history.popByLin.get(lin.id) || [],
          borderColor: rgbToCss(lin.color),
          backgroundColor: rgbToCss(lin.color, 0.12),
          fill: true,
        }));
        chart.update('none');
      };
      update();
      return { chart, update };
    },
  }),
  energy: () => ({
    title: 'avg energy',
    factory: (host) => {
      const chart = makeLineChartCanvas(host);
      const update = () => {
        chart.data.labels = history.labels;
        chart.data.datasets = [...state.world.lineages.values()].map((lin) => ({
          label: lin.name,
          data: history.enByLin.get(lin.id) || [],
          borderColor: rgbToCss(lin.color),
          backgroundColor: rgbToCss(lin.color, 0.12),
          fill: false,
        }));
        chart.update('none');
      };
      update();
      return { chart, update };
    },
  }),
  deaths: () => ({
    title: 'deaths by cause',
    factory: (host) => {
      const chart = makeBarChartCanvas(host, true);
      chart.data.labels = ['deaths'];
      chart.data.datasets = [
        { label: 'starvation', data: [0], backgroundColor: '#ff6b6b' },
        { label: 'predation',  data: [0], backgroundColor: '#c87fff' },
        { label: 'age',        data: [0], backgroundColor: '#7fa9ff' },
      ];
      const update = () => {
        const w = state.world;
        chart.data.datasets[0].data = [w.deathsByCause.starvation || 0];
        chart.data.datasets[1].data = [w.deathsByCause.predation || 0];
        chart.data.datasets[2].data = [w.deathsByCause.age || 0];
        chart.update('none');
      };
      update();
      return { chart, update };
    },
  }),
  zones: () => ({
    title: 'pop by zone',
    factory: (host) => {
      const chart = makeLineChartCanvas(host);
      const update = () => {
        const w = state.world;
        chart.data.labels = history.labels;
        const datasets = [];
        const openData = history.popByZone.get('open');
        if (openData) {
          datasets.push({
            label: 'open',
            data: openData,
            borderColor: '#7a7a92',
            backgroundColor: 'rgba(122, 122, 146, 0.10)',
            fill: true,
          });
        }
        for (const h of w.houses) {
          const arr = history.popByZone.get(`house-${h.id}`);
          if (!arr) continue;
          const lin = w.lineages.get(h.lineageId);
          const color = lin ? rgbToCss(lin.color) : '#888';
          datasets.push({
            label: lin ? lin.name : `house ${h.id}`,
            data: arr,
            borderColor: color,
            backgroundColor: lin ? rgbToCss(lin.color, 0.12) : 'rgba(128, 128, 128, 0.1)',
            fill: true,
          });
        }
        chart.data.datasets = datasets;
        chart.update('none');
      };
      update();
      return { chart, update };
    },
  }),
  stats: () => ({
    title: 'stats summary',
    width: 320,
    height: 180,
    factory: (host) => {
      // Simple metric grid — not a Chart.js chart, just DOM.
      host.innerHTML = `
        <div class="fw-stats">
          <div class="fw-stat"><div class="fw-stat-label">alive</div><div class="fw-stat-value" data-stat="alive">0</div></div>
          <div class="fw-stat"><div class="fw-stat-label">avg gen</div><div class="fw-stat-value" data-stat="avgGen">0.0</div></div>
          <div class="fw-stat"><div class="fw-stat-label">max gen</div><div class="fw-stat-value" data-stat="maxGen">0</div></div>
          <div class="fw-stat"><div class="fw-stat-label">births</div><div class="fw-stat-value" data-stat="births">0</div></div>
        </div>`;
      const cells = {
        alive:  host.querySelector('[data-stat="alive"]'),
        avgGen: host.querySelector('[data-stat="avgGen"]'),
        maxGen: host.querySelector('[data-stat="maxGen"]'),
        births: host.querySelector('[data-stat="births"]'),
      };
      const update = () => {
        const w = state.world;
        cells.alive.textContent = w.organisms.length;
        let totalGen = 0, count = 0;
        for (const o of w.organisms) { totalGen += o.generation; count++; }
        cells.avgGen.textContent = (count ? totalGen / count : 0).toFixed(1);
        cells.maxGen.textContent = w.maxGenerationSeen || 0;
        cells.births.textContent = w.totalBirths || 0;
      };
      update();
      return { chart: null, update };
    },
  }),
  brains: () => ({
    title: 'longest-lived brains',
    width: 380,
    height: 420,
    factory: (host) => {
      host.innerHTML = '<div class="fw-brains"></div>';
      const listEl = host.querySelector('.fw-brains');
      const update = () => renderBrainsList(listEl);
      update();
      return { chart: null, update };
    },
  }),
  phylo:        () => phyloSpec('classic', 'phylogeny (cladistic)'),
  phyloBud:     () => phyloSpec('budding',  'phylogeny (matriarchal)'),
  speciesPop:    () => speciesPopSpec('classic', 'population by species (cladistic)'),
  speciesPopBud: () => speciesPopSpec('budding',  'population by species (matriarchal)'),
};

// One line per species that passes speciesQualifies, sourced from the
// requested phylo tree. Colour matches the species' computed colour (lineage
// base + centroid drift at speciation time).
function speciesPopSpec(mode, title) {
  return {
    title,
    factory: (host) => {
      const chart = makeLineChartCanvas(host);
      const update = () => {
        const w = state.world;
        const phylo = mode === 'budding' ? w.phyloBud : w.phylo;
        const map = mode === 'budding' ? history.popBySpeciesBud : history.popBySpecies;
        chart.data.labels = history.labels;
        const datasets = [];
        for (const s of phylo.species) {
          if (!speciesQualifies(s)) continue;
          const arr = map.get(s.id);
          if (!arr) continue;
          datasets.push({
            label: s.name,
            data: arr,
            borderColor: rgbToCss(s.color),
            backgroundColor: rgbToCss(s.color, 0.1),
            fill: false,
          });
        }
        chart.data.datasets = datasets;
        chart.update('none');
      };
      update();
      return { chart, update };
    },
  };
}

// Shared spec for both phylogeny charts. The only difference is which
// Phylo instance on the world we render.
function phyloSpec(mode, title) {
  const w = Math.min(1280, Math.max(540, window.innerWidth - 40));
  const h = Math.min(820, Math.max(360, window.innerHeight - 120));
  return {
    title,
    width: w,
    height: h,
    x: Math.max(8, (window.innerWidth - w) / 2),
    y: Math.max(8, (window.innerHeight - h - 80) / 2),
    factory: (host) => {
      host.innerHTML = '<div class="fw-phylo"></div>';
      const treeEl = host.querySelector('.fw-phylo');
      const update = () => {
        const phylo = mode === 'budding' ? state.world.phyloBud : state.world.phylo;
        renderPhyloTree(treeEl, phylo);
      };
      update();
      return { chart: null, update };
    },
  };
}

// Phylogeny tree, rendered as an SVG horizontal tree:
//   - X axis is time. Root at the species' bornTick, line ends at diedTick
//     (split point) or at the current sim time (alive species).
//   - Y axis is layout-driven: each leaf gets its own row, internal nodes
//     sit at the mean Y of their children. Multiple lineages stack with a
//     small gap between them.
//   - Lines are coloured by the species colour; a vertical connector at
//     each split joins the parent's terminus to the children's rows.
//   - Tip circle + label sits at the right end of each line. Extinct
//     branches dim + go italic.
// Filters species below CONFIG.phyloMinDisplayPeakPop so spurious blips
// don't crowd the chart (roots always shown).
const SVG_NS = 'http://www.w3.org/2000/svg';

function renderPhyloTree(host, phylo) {
  const w = state.world;
  if (!w || !phylo) return;

  // Display filter:
  //   - Root nodes are always shown
  //   - Other species must have hit phyloMinDisplayPeakPop at some point
  //   - Extinct species must have lived at least phyloMinDisplayLifespanSec
  const visible = phylo.species.filter((s) => {
    if (s.parentId == null) return true;
    if (s.peakPop < CONFIG.phyloMinDisplayPeakPop) return false;
    if (s.diedTick != null) {
      const lifespan = s.diedTick - s.bornTick;
      if (lifespan < CONFIG.phyloMinDisplayLifespanSec) return false;
    }
    return true;
  });

  host.innerHTML = '';
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'phylo-empty';
    empty.textContent = 'no species yet — place a house to seed one.';
    host.appendChild(empty);
    return;
  }

  const visibleSet = new Set(visible.map((s) => s.id));
  const childrenOf = new Map();
  const roots = [];
  for (const s of visible) {
    if (s.parentId == null || !visibleSet.has(s.parentId)) {
      roots.push(s);
    } else {
      if (!childrenOf.has(s.parentId)) childrenOf.set(s.parentId, []);
      childrenOf.get(s.parentId).push(s);
    }
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.bornTick - b.bornTick);
  roots.sort((a, b) => a.lineageId - b.lineageId || a.bornTick - b.bornTick);

  // Every species gets its own row — DFS pre-order. Avoids the collision
  // that happened in matriarchal mode where a parent with a single child
  // ended up at the child's Y (mean of one value = that value). Also
  // simplifies the connector logic (always parent.y → child.y).
  const yPos = new Map();
  let nextLeaf = 0;
  function dfs(node) {
    yPos.set(node.id, nextLeaf++);
    const kids = childrenOf.get(node.id) || [];
    for (const k of kids) dfs(k);
  }
  for (const r of roots) {
    dfs(r);
    nextLeaf += 0.6; // breathing room between independent lineages
  }
  const totalLeaves = Math.max(1, nextLeaf);

  // Time window — clamp so a single, fresh root still produces a sensible
  // axis even when bornTick == tickSec.
  let minT = Infinity, maxT = w.tickSec;
  for (const s of visible) {
    if (s.bornTick < minT) minT = s.bornTick;
    const end = s.diedTick ?? w.tickSec;
    if (end > maxT) maxT = end;
  }
  if (minT === Infinity) minT = 0;
  if (maxT - minT < 1) maxT = minT + 1;

  // Compute size — SVG height grows past the container if many leaves so
  // the host scrolls vertically.
  const containerW = Math.max(220, host.clientWidth || 600);
  const containerH = Math.max(160, host.clientHeight || 400);
  const padLeft = 18;
  const padRight = 210;
  const padTop = 28;
  const padBottom = 20;
  const minLeafSpacing = 26;
  const innerW = Math.max(120, containerW - padLeft - padRight);
  const neededH = totalLeaves * minLeafSpacing + padTop + padBottom;
  const svgH = Math.max(containerH, neededH);
  const innerH = svgH - padTop - padBottom;
  const ySpacing = innerH / totalLeaves;

  const yScale = (yv) => padTop + yv * ySpacing + ySpacing / 2;
  const xScale = (t) => padLeft + ((t - minT) / (maxT - minT)) * innerW;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', `0 0 ${containerW} ${svgH}`);
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

  // Axis hint — light tick label every ~60 seconds.
  const tickStep = chooseTickStep(maxT - minT);
  for (let t = Math.ceil(minT / tickStep) * tickStep; t <= maxT; t += tickStep) {
    const x = xScale(t);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', padTop - 6); line.setAttribute('y2', svgH - padBottom + 6);
    line.setAttribute('stroke', 'rgba(255,255,255,0.04)');
    line.setAttribute('stroke-dasharray', '2 4');
    svg.appendChild(line);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x + 2);
    label.setAttribute('y', padTop - 8);
    label.setAttribute('fill', 'rgba(180,180,200,0.45)');
    label.setAttribute('font-size', '9');
    label.setAttribute('font-family', 'JetBrains Mono');
    label.textContent = `${Math.round(t)}s`;
    svg.appendChild(label);
  }

  const rgba = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  // Vertical connectors: drawn at each child's bornTick from the parent's
  // y to the child's y. Works uniformly for classic splits (parent dies at
  // child.bornTick) and matriarchal budding (parent continues past it).
  const byId = new Map();
  for (const s of visible) byId.set(s.id, s);
  for (const s of visible) {
    if (s.parentId == null) continue;
    const parent = byId.get(s.parentId);
    if (!parent) continue;
    const py = yScale(yPos.get(parent.id));
    const cy = yScale(yPos.get(s.id));
    if (Math.abs(py - cy) < 0.5) continue;
    const x = xScale(s.bornTick);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', py); line.setAttribute('y2', cy);
    line.setAttribute('stroke', rgba(parent.color, 0.55));
    line.setAttribute('stroke-width', 1.8);
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }

  // Branches + tips.
  for (const s of visible) {
    const extinct = s.diedTick != null;
    const y = yScale(yPos.get(s.id));
    const x1 = xScale(s.bornTick);
    const x2 = xScale(s.diedTick ?? w.tickSec);

    const seg = document.createElementNS(SVG_NS, 'line');
    seg.setAttribute('x1', x1); seg.setAttribute('y1', y);
    seg.setAttribute('x2', x2); seg.setAttribute('y2', y);
    seg.setAttribute('stroke', rgba(s.color, extinct ? 0.45 : 1));
    seg.setAttribute('stroke-width', extinct ? 1.8 : 3);
    seg.setAttribute('stroke-linecap', 'round');
    svg.appendChild(seg);

    const tip = document.createElementNS(SVG_NS, 'circle');
    tip.setAttribute('cx', x2); tip.setAttribute('cy', y);
    tip.setAttribute('r', extinct ? 3.5 : 6);
    tip.setAttribute('fill', rgba(s.color, extinct ? 0.4 : 1));
    if (!extinct) {
      tip.setAttribute('stroke', rgba(s.color, 1));
      tip.setAttribute('stroke-width', 1.5);
    }
    svg.appendChild(tip);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x2 + 11);
    label.setAttribute('y', y + 3.5);
    label.setAttribute('fill', extinct ? 'rgba(180,180,200,0.45)' : '#e6e6f0');
    label.setAttribute('font-size', '11');
    label.setAttribute('font-family', 'JetBrains Mono');
    if (extinct) label.setAttribute('font-style', 'italic');
    const stat = extinct
      ? ` × ${Math.max(0, Math.floor(s.diedTick - s.bornTick))}s`
      : `  ${s.currentPop}`;
    label.textContent = `${s.name}${stat}`;
    svg.appendChild(label);
  }

  host.appendChild(svg);
}

function chooseTickStep(rangeSec) {
  if (rangeSec <= 30) return 5;
  if (rangeSec <= 120) return 20;
  if (rangeSec <= 360) return 60;
  if (rangeSec <= 1200) return 120;
  return 300;
}

// Finds the longest-lived currently-alive organism per lineage and renders a
// row with a compact neural-network diagram for each. Rebuilds the DOM each
// tick — cheap with <10 lineages and small canvases.
function renderBrainsList(host) {
  const w = state.world;
  if (!w) return;

  const oldestByLin = new Map();
  for (const o of w.organisms) {
    const cur = oldestByLin.get(o.lineageId);
    if (!cur || o.ageSec > cur.ageSec) oldestByLin.set(o.lineageId, o);
  }

  host.innerHTML = '';
  for (const lin of w.lineages.values()) {
    const row = document.createElement('div');
    row.className = 'brains-row';

    const meta = document.createElement('div');
    meta.className = 'brains-meta';
    const swatch = document.createElement('span');
    swatch.className = 'brains-swatch';
    swatch.style.background = `rgb(${lin.color[0]}, ${lin.color[1]}, ${lin.color[2]})`;
    const name = document.createElement('span');
    name.className = 'brains-name';
    name.textContent = lin.name;
    const stat = document.createElement('span');
    stat.className = 'brains-age';
    meta.appendChild(swatch);
    meta.appendChild(name);
    meta.appendChild(stat);
    row.appendChild(meta);

    const org = oldestByLin.get(lin.id);
    if (!org) {
      stat.textContent = 'extinct';
      const empty = document.createElement('div');
      empty.className = 'brains-empty';
      empty.textContent = '—';
      row.appendChild(empty);
    } else {
      stat.textContent = `gen ${org.generation} · ${org.ageSec.toFixed(1)}s · e${Math.round(org.energy)}`;
      const canvas = document.createElement('canvas');
      canvas.className = 'brains-canvas';
      canvas.width = 340;
      canvas.height = 90;
      row.appendChild(canvas);
      // Defer until layout so devicePixelRatio path could be used later.
      drawNeuralNet(canvas, org.brain, lin.color);
    }

    host.appendChild(row);
  }
}

// Compact NN diagram: 4 columns of dots, weighted lines between layers.
// Green = positive weight, red = negative; alpha scales with |weight|.
function drawNeuralNet(canvas, brain, lineageColor) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const layers = brain.layers;
  const padX = 14, padY = 6;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  // Pre-compute node positions per layer.
  const nodes = layers.map((count, layerIdx) => {
    const x = padX + (innerW * layerIdx) / (layers.length - 1);
    const positions = new Array(count);
    for (let i = 0; i < count; i++) {
      positions[i] = { x, y: padY + (innerH * (i + 0.5)) / count };
    }
    return positions;
  });

  // Edges — normalise alpha per layer so each layer's strongest weight pops.
  for (let layerIdx = 1; layerIdx < layers.length; layerIdx++) {
    const fromNodes = nodes[layerIdx - 1];
    const toNodes = nodes[layerIdx];
    const wBase = brain.layerOffsets[layerIdx - 1];
    const inSize = layers[layerIdx - 1];
    const outSize = layers[layerIdx];
    const stride = inSize + 1;

    let maxAbs = 1e-4;
    for (let i = 0; i < outSize * stride; i++) {
      const a = Math.abs(brain.weights[wBase + i]);
      if (a > maxAbs) maxAbs = a;
    }

    ctx.lineWidth = 0.6;
    for (let o = 0; o < outSize; o++) {
      const rowStart = wBase + o * stride;
      for (let i = 0; i < inSize; i++) {
        const ww = brain.weights[rowStart + i];
        const absW = Math.abs(ww);
        // Drop the bottom 25% by magnitude — visual signal-to-noise.
        if (absW < maxAbs * 0.25) continue;
        const alpha = Math.min(0.85, (absW / maxAbs) * 0.7);
        ctx.strokeStyle = ww > 0
          ? `rgba(127, 255, 212, ${alpha})`
          : `rgba(255, 107, 107, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(fromNodes[i].x, fromNodes[i].y);
        ctx.lineTo(toNodes[o].x, toNodes[o].y);
        ctx.stroke();
      }
    }
  }

  // Nodes — last layer (outputs) tinted lineage colour as a subtle accent.
  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const isOutput = layerIdx === layers.length - 1;
    ctx.fillStyle = isOutput
      ? `rgb(${lineageColor[0]}, ${lineageColor[1]}, ${lineageColor[2]})`
      : 'rgba(220, 220, 232, 0.9)';
    for (const n of nodes[layerIdx]) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, isOutput ? 2.2 : 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function openChartWindow(key) {
  if (openCharts.has(key)) return; // already open
  const factory = chartFactories[key];
  if (!factory) return;
  const spec = factory();

  const stagger = nextOffset % 6;
  nextOffset++;
  const win = new FloatingWindow({
    id: `chart-${key}`,
    title: spec.title,
    width: spec.width || 380,
    height: spec.height || 220,
    x: spec.x !== undefined ? spec.x : 80 + stagger * 32,
    y: spec.y !== undefined ? spec.y : 90 + stagger * 32,
    onOpen: (host, w) => {
      const { chart, update } = spec.factory(host);
      openCharts.set(key, { window: w, chart, update });
    },
    onClose: () => {
      const entry = openCharts.get(key);
      if (entry && entry.chart && entry.chart.destroy) entry.chart.destroy();
      openCharts.delete(key);
    },
  });
  win.open();
}

// ============================================================================
// UI transparency state machine
// ============================================================================
const fadeState = {
  transparency: 0,        // 0-100, from slider
  settingsOpen: false,
  visibility: 'visible',  // 'visible' | 'peek' | 'hidden'
  timer: null,
};

function applyFade() {
  const root = document.documentElement;
  let alpha = 1 - fadeState.transparency / 100;
  let pointer = 'auto';
  if (fadeState.transparency > CONFIG.uiAutohideThreshold) {
    if (fadeState.visibility === 'hidden') {
      alpha = 0; pointer = 'none';
    } else {
      alpha = CONFIG.uiPeekAlpha; pointer = 'auto';
    }
  }
  root.style.setProperty('--ui-alpha', String(alpha));
  root.style.setProperty('--ui-pointer', pointer);
}

function setTransparency(v) {
  fadeState.transparency = v;
  recomputeFade();
}

function setSettingsPopupOpen(open) {
  fadeState.settingsOpen = open;
  recomputeFade();
}

function recomputeFade() {
  clearTimeout(fadeState.timer);
  if (fadeState.transparency <= CONFIG.uiAutohideThreshold) {
    fadeState.visibility = 'visible';
    applyFade();
    return;
  }
  // Above-threshold: peek by default, then schedule hide unless settings is open.
  fadeState.visibility = 'peek';
  applyFade();
  if (!fadeState.settingsOpen) {
    fadeState.timer = setTimeout(() => {
      fadeState.visibility = 'hidden';
      applyFade();
    }, CONFIG.uiAutohideDelayMs);
  }
}

// Called on any pointer activity. If we're hidden, peek for a few seconds.
function notifyUserActivity() {
  if (fadeState.transparency <= CONFIG.uiAutohideThreshold) return;
  if (fadeState.settingsOpen) return;
  clearTimeout(fadeState.timer);
  fadeState.visibility = 'peek';
  applyFade();
  fadeState.timer = setTimeout(() => {
    fadeState.visibility = 'hidden';
    applyFade();
  }, CONFIG.uiPeekDelayMs);
}

// ============================================================================
// Bottom bar + popups
// ============================================================================
const popups = {};

function setupBottomBar() {
  document.querySelectorAll('#bottom-bar .bbtn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'pause') { togglePause(); closeAllPopups(); return; }
      togglePopup(action);
    });
  });

  popups.charts = document.getElementById('popup-charts');
  popups.settings = document.getElementById('popup-settings');
  popups.world = document.getElementById('popup-world');

  // Chart menu items
  popups.charts.querySelectorAll('[data-chart]').forEach((b) => {
    b.addEventListener('click', () => {
      openChartWindow(b.dataset.chart);
      closeAllPopups();
    });
  });

  // World popup — open-world food spawn rate (writes CONFIG live, and stays
  // in sync when the auto-reduction below ticks the rate down).
  const foodSlider = document.getElementById('food-spawn-rate');
  const foodValueEl = document.getElementById('food-spawn-rate-value');
  if (foodSlider && foodValueEl) {
    foodSlider.value = String(CONFIG.foodSpawnRatePerSec);
    foodValueEl.textContent = String(CONFIG.foodSpawnRatePerSec);
    foodSlider.addEventListener('input', () => {
      const v = parseInt(foodSlider.value, 10);
      foodValueEl.textContent = String(v);
      CONFIG.foodSpawnRatePerSec = v;
    });
    // Poll for world auto-reductions and reflect them in the slider so the
    // displayed value never drifts from the actual config.
    setInterval(() => {
      const cur = Math.round(CONFIG.foodSpawnRatePerSec);
      if (foodSlider.value !== String(cur)) {
        foodSlider.value = String(cur);
        foodValueEl.textContent = String(cur);
      }
    }, 1000);
  }

  // World popup — open-world gradual food reduction controls.
  const worldRedToggle = document.getElementById('world-reduction');
  const worldRedInterval = document.getElementById('world-reduction-interval');
  const worldRedFloor = document.getElementById('world-reduction-floor');
  if (worldRedToggle && worldRedInterval && worldRedFloor) {
    worldRedToggle.checked = CONFIG.worldGradualReduction;
    worldRedInterval.value = String(CONFIG.worldReductionIntervalDays);
    worldRedFloor.value = String(CONFIG.worldFoodRateFloor);
    worldRedToggle.addEventListener('change', () => {
      CONFIG.worldGradualReduction = worldRedToggle.checked;
    });
    worldRedInterval.addEventListener('input', () => {
      const v = parseInt(worldRedInterval.value, 10);
      if (Number.isFinite(v) && v >= 1) CONFIG.worldReductionIntervalDays = v;
    });
    worldRedFloor.addEventListener('input', () => {
      const v = parseInt(worldRedFloor.value, 10);
      if (Number.isFinite(v) && v >= 0) CONFIG.worldFoodRateFloor = v;
    });
  }

  // World popup speed + reset
  popups.world.querySelectorAll('.speed-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const speedVal = parseFloat(b.dataset.speed);
      const idx = CONFIG.speedSteps.indexOf(speedVal);
      if (idx >= 0) state.speedIdx = idx;
      updateSpeedButtons();
    });
  });
  const followBtn = popups.world.querySelector('[data-action="follow-best"]');
  followBtn.addEventListener('click', () => {
    state.followBest = !state.followBest;
    followBtn.textContent = state.followBest ? 'stop following' : 'follow best';
    followBtn.classList.toggle('active', state.followBest);
  });

  popups.world.querySelector('[data-action="reset"]').addEventListener('click', () => {
    state.world.reset();
    resetHistoryBuffers();
    state.world.deathsByCause.starvation = 0;
    state.world.deathsByCause.age = 0;
    state.world.deathsByCause.predation = 0;
    closeAllPopups();
  });
  popups.world.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
    state.world.clearAll();
    resetHistoryBuffers();
    state.world.deathsByCause.starvation = 0;
    state.world.deathsByCause.age = 0;
    state.world.deathsByCause.predation = 0;
    closeAllPopups();
  });
  popups.world.querySelector('[data-action="spawn-predator"]').addEventListener('click', () => {
    state.world.spawnPredator();
  });
  popups.world.querySelector('[data-action="clear-predators"]').addEventListener('click', () => {
    state.world.predators.length = 0;
  });

  const saveStatus = document.getElementById('save-status');
  const loadBtn = document.getElementById('btn-load');
  const refreshLoadBtn = () => {
    if (loadBtn) {
      loadBtn.disabled = !hasSavedWorld();
      loadBtn.style.opacity = loadBtn.disabled ? '0.4' : '';
      loadBtn.style.cursor = loadBtn.disabled ? 'not-allowed' : '';
    }
  };
  refreshLoadBtn();

  popups.world.querySelector('[data-action="save"]').addEventListener('click', () => {
    const res = saveWorld(state.world);
    if (saveStatus) {
      saveStatus.textContent = res.ok
        ? `saved ${(res.bytes / 1024).toFixed(1)} kb`
        : `save failed: ${res.error}`;
    }
    refreshLoadBtn();
  });

  loadBtn.addEventListener('click', () => {
    if (loadBtn.disabled) return;
    const loaded = loadWorld();
    if (!loaded) {
      if (saveStatus) saveStatus.textContent = 'load failed';
      return;
    }
    state.world = loaded;
    // Resize spatial grids in case the saved world used a different size.
    state.world.resize(state.world.width, state.world.height);
    // History buffers were keyed by lineage; rebuild for whichever lineages
    // came back.
    history.labels.length = 0;
    history.popByLin.clear();
    history.enByLin.clear();
    for (const lin of state.world.lineages.values()) ensureLineageHistory(lin);
    if (saveStatus) saveStatus.textContent = `loaded · ${state.world.organisms.length} organisms`;
    closeAllPopups();
  });

  // Settings: transparency slider
  const slider = document.getElementById('ui-transparency');
  const valueEl = document.getElementById('ui-transparency-value');
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    valueEl.textContent = `${v}%`;
    setTransparency(v);
  });

  // Settings: mutation chance slider — writes CONFIG.mutationEventChance
  // live so the next reproduction event sees the new value.
  const mutSlider = document.getElementById('mutation-chance');
  const mutValueEl = document.getElementById('mutation-chance-value');
  mutSlider.value = Math.round(CONFIG.mutationEventChance * 100);
  mutValueEl.textContent = `${mutSlider.value}%`;
  mutSlider.addEventListener('input', () => {
    const v = parseInt(mutSlider.value, 10);
    mutValueEl.textContent = `${v}%`;
    CONFIG.mutationEventChance = v / 100;
  });


  // Dismiss popups on outside click — but only after the click finishes
  // (otherwise the very click that opens a popup also closes it).
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.popup') || e.target.closest('#bottom-bar')) return;
    closeAllPopups();
  });

  // Initial speed highlight
  updateSpeedButtons();
}

function togglePopup(key) {
  const el = popups[key];
  if (!el) return;
  const wasOpen = !el.classList.contains('hidden');
  closeAllPopups();
  if (!wasOpen) {
    el.classList.remove('hidden');
    anchorPopupAbove(el, key);
    setBottomBtnActive(key, true);
    if (key === 'settings') setSettingsPopupOpen(true);
  }
}

function closeAllPopups() {
  for (const k of Object.keys(popups)) {
    popups[k].classList.add('hidden');
    setBottomBtnActive(k, false);
  }
  if (fadeState.settingsOpen) setSettingsPopupOpen(false);
}

function setBottomBtnActive(action, isActive) {
  const btn = document.querySelector(`#bottom-bar .bbtn[data-action="${action}"]`);
  if (btn) btn.classList.toggle('active', isActive);
}

// Position popup horizontally above its anchor button so it visually points
// to the right control.
function anchorPopupAbove(popup, action) {
  const btn = document.querySelector(`#bottom-bar .bbtn[data-action="${action}"]`);
  if (!btn) return;
  const btnRect = btn.getBoundingClientRect();
  // Measure popup AFTER it's visible (display set above).
  const popRect = popup.getBoundingClientRect();
  const desiredCenter = btnRect.left + btnRect.width / 2;
  let left = desiredCenter - popRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - popRect.width - 8, left));
  popup.style.left = `${left}px`;
  // Bottom stays at CSS-default; clear any transform from the centered default.
  popup.style.transform = 'none';
}

function updateSpeedButtons() {
  const current = CONFIG.speedSteps[state.speedIdx];
  popups.world.querySelectorAll('.speed-btn').forEach((b) => {
    const v = parseFloat(b.dataset.speed);
    b.classList.toggle('active', v === current);
  });
}

function togglePause() {
  state.paused = !state.paused;
  const icon = document.getElementById('bbtn-pause-icon');
  const label = document.getElementById('bbtn-pause-label');
  icon.textContent = state.paused ? '▶' : '❚❚';
  label.textContent = state.paused ? 'play' : 'pause';
}

// ============================================================================
// Toolbar (top-right) — wired explicitly here instead of through p5 so the
// buttons get clean DOM clicks (no interference from canvas events).
// ============================================================================
function setupToolbar() {
  const buttons = document.querySelectorAll('#toolbar .tool');
  buttons.forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setTool(b.dataset.tool);
    });
  });
  onToolChange((name) => {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
    const placing = name === 'house' || name === 'zone' || name === 'barrier';
    document.body.classList.toggle('placing', placing);
    document.body.classList.toggle('editing', name === 'edit');
    document.body.classList.toggle('erasing', name === 'erase');
  });
}

// ============================================================================
// House placement flow
// ============================================================================
function pickOldestOrganism(world) {
  let best = null;
  let bestAge = -Infinity;
  for (const o of world.organisms) {
    if (o.ageSec > bestAge) { bestAge = o.ageSec; best = o; }
  }
  return best;
}

function handlePlaceBarrier(x1, y1, x2, y2) {
  const w = state.world;
  const existingLineages = [...w.lineages.values()];
  showBarrierModal(
    existingLineages,
    (data) => {
      const barrier = new Barrier(
        [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        {
          color: data.color,
          thickness: data.thickness,
          allowedLineages: data.allowedLineages,
          transparentFromSideA: data.transparentFromSideA,
          transparentFromSideB: data.transparentFromSideB,
        },
      );
      w.addBarrier(barrier);
      setTool('select');
    },
    () => setTool('select'),
  );
}

function handleErase(x, y) {
  const w = state.world;
  const hit = w.findEntityAt(x, y);
  if (!hit) return;
  if (hit.type === 'barrier') {
    w.removeBarrier(hit.entity.id);
  } else if (hit.type === 'house') {
    // Drop the zone-history key so the line stops growing once removed.
    history.popByZone.delete(`house-${hit.entity.id}`);
    w.removeHouse(hit.entity.id);
  } else if (hit.type === 'zone') {
    w.removeZone(hit.entity.id);
  }
}

function handleEdit(x, y) {
  const w = state.world;
  const hit = w.findEntityAt(x, y);
  if (!hit) return;
  const existingLineages = [...w.lineages.values()];
  if (hit.type === 'house') {
    const house = hit.entity;
    showHouseModal(
      { name: '', color: [0, 0, 0] }, existingLineages,
      (data) => {
        // Apply data to the existing house. Lineage id stays the same;
        // home lineage is auto-added back by the Set.
        house.zone.foodDensity = data.foodDensity;
        // User explicitly set this density value — treat it as the new
        // baseline for persistence respawn to restore to.
        house.foodDensityInitial = data.foodDensity;
        house.zone.foodEnergy = data.foodEnergy;
        house.zone.decayMultiplier = data.decayMultiplier;
        house.zone.predatorsAllowed = data.predatorsAllowed;
        house.zone.gradualReduction = data.gradualReduction;
        house.zone.reductionIntervalDays = data.reductionIntervalDays;
        house.zone.foodDensityFloor = data.foodDensityFloor;
        house.zone.persistence = data.persistence;
        // If reduction was just turned on, seed the next-reduction timer
        // from the current world tick so the first drop happens one step
        // from now (not retroactive).
        if (data.gradualReduction && (house._nextReductionTickSec == null
            || house._nextReductionTickSec < state.world.tickSec)) {
          house._nextReductionTickSec = state.world.tickSec +
            data.reductionIntervalDays * CONFIG.dayLengthSec;
        }
        house.barrier.transparentFromInside = data.transparentFromInside;
        house.barrier.transparentFromOutside = data.transparentFromOutside;
        const allowed = new Set(data.allowedLineages);
        allowed.add(house.lineageId);
        house.allowedLineages = allowed;
        setTool('select');
      },
      () => setTool('select'),
      house,
    );
  } else if (hit.type === 'zone') {
    const zone = hit.entity;
    showZoneModal(
      existingLineages,
      (data) => {
        zone.color = [...data.color];
        zone.zone.foodDensity = data.foodDensity;
        zone.zone.foodEnergy = data.foodEnergy;
        zone.zone.decayMultiplier = data.decayMultiplier;
        zone.zone.predatorsAllowed = data.predatorsAllowed;
        zone.allowedLineages = new Set(data.allowedLineages);
        setTool('select');
      },
      () => setTool('select'),
      zone,
    );
  } else if (hit.type === 'barrier') {
    const bar = hit.entity;
    showBarrierModal(
      existingLineages,
      (data) => {
        bar.color = [...data.color];
        bar.thickness = data.thickness;
        bar.transparentFromSideA = data.transparentFromSideA;
        bar.transparentFromSideB = data.transparentFromSideB;
        bar.allowedLineages = new Set(data.allowedLineages);
        setTool('select');
      },
      () => setTool('select'),
      bar,
    );
  }
}

function handlePlaceZone(x, y, radius) {
  const w = state.world;
  const existingLineages = [...w.lineages.values()];
  showZoneModal(
    existingLineages,
    (data) => {
      const zone = new Zone(
        x, y, radius, data.color,
        {
          foodDensity: data.foodDensity,
          foodEnergy: data.foodEnergy,
          decayMultiplier: data.decayMultiplier,
          predatorsAllowed: data.predatorsAllowed,
        },
        data.allowedLineages,
      );
      w.addZone(zone);
      setTool('select');
    },
    () => setTool('select'),
  );
}

function handlePlaceHouse(x, y, radius) {
  const w = state.world;
  const suggested = suggestNextLineageDefaults(w.lineages.values());
  const existingLineages = [...w.lineages.values()];
  showHouseModal(
    suggested,
    existingLineages,
    (data) => {
      const lineage = createLineage(data.name, data.color);
      w.addLineage(lineage);
      const house = new House(
        x, y, radius, lineage.id,
        {
          foodDensity: data.foodDensity,
          foodEnergy: data.foodEnergy,
          decayMultiplier: data.decayMultiplier,
          predatorsAllowed: data.predatorsAllowed,
          gradualReduction: data.gradualReduction,
          reductionIntervalDays: data.reductionIntervalDays,
          foodDensityFloor: data.foodDensityFloor,
          persistence: data.persistence,
        },
        {
          transparentFromInside: data.transparentFromInside,
          transparentFromOutside: data.transparentFromOutside,
        },
        data.allowedLineages, // extra lineages the user ticked; new one is added by House
      );
      w.addHouse(house);
      w.seedFoundersForHouse(house, data.founders);
      ensureLineageHistory(lineage);
      setTool('select');
    },
    () => setTool('select'),
  );
}

// ============================================================================
// Boot
// ============================================================================
// PWA bits — register a no-cache service worker and capture the install
// prompt event so a button in Settings can trigger it. iOS Safari does not
// fire beforeinstallprompt, so the button just stays hidden there and the
// settings popup keeps showing the manual "add to home screen" hint.
let deferredInstallPrompt = null;

function setupPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Active development: ask the browser to check for an updated SW on
      // every page load. Combined with the SW's cache: 'no-cache' fetches
      // this keeps users on the latest code without manual clearing.
      reg.update().catch(() => { /* ignore */ });
    }).catch(() => { /* not critical */ });
  }

  // Lock to the device's natural orientation when running as an installed
  // PWA. The manifest already requests "natural" but mobile browsers won't
  // always honour OS rotation lock for web content; this call enforces it
  // at the JS layer. Fails silently when not in standalone / fullscreen.
  if (screen && screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('natural').catch(() => { /* not supported in this context */ });
  }

  // Fullscreen attempt — manifest "display: fullscreen" handles the
  // installed PWA path. For a regular browser tab, request fullscreen on
  // the first user gesture (browsers reject the call without one). Only
  // runs once and only when not already fullscreen.
  const tryFullscreen = () => {
    document.removeEventListener('pointerdown', tryFullscreen);
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try { req.call(el, { navigationUI: 'hide' }).catch(() => {}); }
    catch (_) { /* not allowed in this context */ }
  };
  document.addEventListener('pointerdown', tryFullscreen, { once: true });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallButton(true);
  });

  window.addEventListener('appinstalled', () => {
    showInstallButton(false);
    deferredInstallPrompt = null;
    const hint = document.getElementById('install-hint');
    if (hint) hint.textContent = 'installed.';
  });

  const installBtn = document.getElementById('btn-install');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try {
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') showInstallButton(false);
      } catch (_) { /* user dismissed */ }
      deferredInstallPrompt = null;
    });
  }
}

function showInstallButton(show) {
  const btn = document.getElementById('btn-install');
  const hint = document.getElementById('install-hint');
  if (btn) btn.hidden = !show;
  if (hint) hint.style.display = show ? 'none' : '';
}

window.addEventListener('DOMContentLoaded', () => {
  new p5(sketch);
  setupBottomBar();
  setupToolbar();
  setupPwa();
  onPlaceHouse(handlePlaceHouse);
  onPlaceZone(handlePlaceZone);
  onPlaceBarrier(handlePlaceBarrier);
  onErase(handleErase);
  onEdit(handleEdit);

  const v = document.getElementById('version-tag');
  if (v) v.textContent = CONFIG.version;

  applyFade(); // ensure initial CSS vars are set

  function hudLoop() { updateHud(); requestAnimationFrame(hudLoop); }
  hudLoop();
  setInterval(tickHistory, CONFIG.statsIntervalMs);
});
