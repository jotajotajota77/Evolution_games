import { CONFIG } from './config.js';
import { World } from './world.js';
import {
  attachP5, rebuildVignette, drawTrailFade,
  drawFood, drawOrganisms, drawHouses, drawHousePreview,
  drawVignette, drawNightTint, paintBackground,
} from './renderer.js';
import { createLineage, suggestNextLineageDefaults } from './lineage.js';
import { House } from './house.js';
import {
  setTool, getTool, isModalOpen, onPlaceHouse, onToolChange,
  onMouseDown, onMouseMove, onMouseUp, getDrag,
} from './tools.js';
import { showHouseModal } from './ui.js';
import { FloatingWindow } from './windows.js';

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

    window.addEventListener('resize', () => {
      const nw = host.clientWidth;
      const nh = host.clientHeight;
      p.resizeCanvas(nw, nh);
      rebuildVignette(nw, nh);
      paintBackground();
      state.world.resize(nw, nh);
    });
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
    drawHouses(state.world);
    drawFood(state.world);
    drawOrganisms(state.world);
    drawHousePreview(getDrag());
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
};

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
    const popArr = history.popByLin.get(lin.id);
    const enArr = history.enByLin.get(lin.id);
    popArr.push(pop);
    enArr.push(avgE);
    if (popArr.length > CONFIG.statsHistoryPoints) popArr.shift();
    if (enArr.length > CONFIG.statsHistoryPoints) enArr.shift();
  }

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
        { label: 'age',        data: [0], backgroundColor: '#7fa9ff' },
      ];
      const update = () => {
        const w = state.world;
        chart.data.datasets[0].data = [w.deathsByCause.starvation || 0];
        chart.data.datasets[1].data = [w.deathsByCause.age || 0];
        chart.update('none');
      };
      update();
      return { chart, update };
    },
  }),
  zones: () => ({
    title: 'pop by zone',
    factory: (host) => {
      const chart = makeBarChartCanvas(host, false);
      const update = () => {
        const w = state.world;
        const housed = [...w.lineages.values()].filter((l) => l.house);
        const labels = ['open', ...housed.map((l) => l.name)];
        const colors = ['#3a3a4a', ...housed.map((l) => rgbToCss(l.color, 0.7))];
        const counts = new Array(labels.length).fill(0);
        for (const o of w.organisms) {
          let placed = false;
          for (let i = 0; i < housed.length; i++) {
            if (housed[i].house.contains(o.x, o.y)) { counts[1 + i]++; placed = true; break; }
          }
          if (!placed) counts[0]++;
        }
        chart.data.labels = labels;
        chart.data.datasets = [{ data: counts, backgroundColor: colors }];
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
};

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
    x: 80 + stagger * 32,
    y: 90 + stagger * 32,
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

  // World popup speed + reset
  popups.world.querySelectorAll('.speed-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const speedVal = parseFloat(b.dataset.speed);
      const idx = CONFIG.speedSteps.indexOf(speedVal);
      if (idx >= 0) state.speedIdx = idx;
      updateSpeedButtons();
    });
  });
  popups.world.querySelector('[data-action="reset"]').addEventListener('click', () => {
    state.world.reset();
    history.labels.length = 0;
    for (const arr of history.popByLin.values()) arr.length = 0;
    for (const arr of history.enByLin.values()) arr.length = 0;
    state.world.deathsByCause.starvation = 0;
    state.world.deathsByCause.age = 0;
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
    document.body.classList.toggle('placing', name === 'house');
  });
}

// ============================================================================
// House placement flow
// ============================================================================
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
window.addEventListener('DOMContentLoaded', () => {
  new p5(sketch);
  setupBottomBar();
  setupToolbar();
  onPlaceHouse(handlePlaceHouse);

  const v = document.getElementById('version-tag');
  if (v) v.textContent = CONFIG.version;

  applyFade(); // ensure initial CSS vars are set

  function hudLoop() { updateHud(); requestAnimationFrame(hudLoop); }
  hudLoop();
  setInterval(tickHistory, CONFIG.statsIntervalMs);
});
