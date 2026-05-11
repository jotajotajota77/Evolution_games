import { CONFIG } from './config.js';
import { World } from './world.js';
import {
  attachP5, rebuildVignette, drawTrailFade,
  drawFood, drawOrganisms, drawVignette, paintBackground,
} from './renderer.js';

// ---- runtime state ----
const state = {
  world: null,
  paused: false,
  speedIdx: 0,                 // index into CONFIG.speedSteps
  lastFrameMs: 0,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
  // Phase 1 has only the default lineage. Future phases populate this from UI.
  lineages: [{ ...CONFIG.defaultLineage }],
  lineageById: new Map([[CONFIG.defaultLineage.id, CONFIG.defaultLineage]]),
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
    const realDt = Math.min(0.1, (now - state.lastFrameMs) / 1000); // clamp to avoid jumps
    state.lastFrameMs = now;

    // FPS smoothing.
    state.fpsAccum += realDt;
    state.fpsFrames += 1;
    if (state.fpsAccum >= 0.5) {
      state.fps = Math.round(state.fpsFrames / state.fpsAccum);
      state.fpsAccum = 0;
      state.fpsFrames = 0;
    }

    if (!state.paused) {
      const speed = CONFIG.speedSteps[state.speedIdx];
      // Sub-step at high speed multipliers so motion stays smooth and food doesn't
      // tunnel past organisms in a single big step.
      const subSteps = Math.min(8, Math.max(1, Math.ceil(speed)));
      const dt = (realDt * speed) / subSteps;
      for (let i = 0; i < subSteps; i++) state.world.update(dt);
    }

    // Render: trail-fade overlay, then entities, then vignette on top.
    drawTrailFade();
    drawFood(state.world);
    drawOrganisms(state.world, state.lineageById);
    drawVignette();
  };
};

// ---- HUD ----
function updateHud() {
  const w = state.world;
  if (!w) return;
  document.getElementById('hud-pop').textContent = w.organisms.length;
  document.getElementById('hud-food').textContent = w.food.length;
  document.getElementById('hud-fps').textContent = state.fps;
  // Phase 1 has no day/night — show elapsed sim time.
  const total = Math.floor(w.tickSec);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  document.getElementById('hud-time').textContent = `${mm}:${ss}`;
}

// ---- Charts (Chart.js) ----
const charts = {};

function chartTheme() {
  return {
    color: '#8a8aa0',
    grid: '#1f1f2e',
    axis: '#2a2a3a',
  };
}

function makeLineChart(canvasId, labels = []) {
  const ctx = document.getElementById(canvasId);
  const t = chartTheme();
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      elements: {
        point: { radius: 0 },
        line: { borderWidth: 1.5, tension: 0.25 },
      },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
          grid: { color: t.grid, drawTicks: false },
          border: { color: t.axis },
        },
        y: {
          ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
          grid: { color: t.grid, drawTicks: false },
          border: { color: t.axis },
          beginAtZero: true,
        },
      },
    },
  });
}

function makeBarChart(canvasId) {
  const ctx = document.getElementById(canvasId);
  const t = chartTheme();
  return new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' } },
          grid: { display: false },
          border: { color: t.axis },
          stacked: true,
        },
        y: {
          ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
          grid: { color: t.grid, drawTicks: false },
          border: { color: t.axis },
          stacked: true,
          beginAtZero: true,
        },
      },
    },
  });
}

function rgbToCss([r, g, b], a = 1) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function setupCharts() {
  charts.pop = makeLineChart('chart-pop');
  charts.energy = makeLineChart('chart-energy');
  charts.deaths = makeBarChart('chart-deaths');
  charts.zone = makeBarChart('chart-zone');

  // Seed each line chart with a dataset per lineage.
  for (const lin of state.lineages) {
    const color = rgbToCss(lin.color);
    charts.pop.data.datasets.push({
      label: lin.name, data: [], borderColor: color,
      backgroundColor: rgbToCss(lin.color, 0.15), fill: true,
    });
    charts.energy.data.datasets.push({
      label: lin.name, data: [], borderColor: color,
      backgroundColor: rgbToCss(lin.color, 0.15), fill: false,
    });
  }

  // Deaths: stacked bars by cause. Phase 1 has just two causes.
  charts.deaths.data.labels = ['deaths'];
  charts.deaths.data.datasets = [
    { label: 'starvation', data: [0], backgroundColor: '#ff6b6b' },
    { label: 'age',        data: [0], backgroundColor: '#7fa9ff' },
  ];

  // Zones: phase 1 has none, so show the "open" world as the single bucket.
  charts.zone.data.labels = ['open'];
  charts.zone.data.datasets = [{
    data: [0],
    backgroundColor: state.lineages.map(l => rgbToCss(l.color, 0.7)),
  }];
}

// History buffers — one ring buffer per metric/lineage.
const history = {
  labels: [],         // time strings
  popByLin: new Map(), // lineageId -> number[]
  enByLin: new Map(),
};

function pushHistory() {
  const w = state.world;
  if (!w) return;

  // Time label.
  const t = Math.floor(w.tickSec);
  history.labels.push(`${t}s`);
  if (history.labels.length > CONFIG.statsHistoryPoints) history.labels.shift();

  // Per-lineage population + average energy.
  const popMap = new Map();
  const sumE = new Map();
  for (const lin of state.lineages) { popMap.set(lin.id, 0); sumE.set(lin.id, 0); }
  for (const o of w.organisms) {
    popMap.set(o.lineageId, (popMap.get(o.lineageId) || 0) + 1);
    sumE.set(o.lineageId, (sumE.get(o.lineageId) || 0) + o.energy);
  }
  for (const lin of state.lineages) {
    const pop = popMap.get(lin.id) || 0;
    const avgE = pop > 0 ? sumE.get(lin.id) / pop : 0;

    if (!history.popByLin.has(lin.id)) history.popByLin.set(lin.id, []);
    if (!history.enByLin.has(lin.id)) history.enByLin.set(lin.id, []);
    const popArr = history.popByLin.get(lin.id);
    const enArr = history.enByLin.get(lin.id);
    popArr.push(pop);
    enArr.push(avgE);
    if (popArr.length > CONFIG.statsHistoryPoints) popArr.shift();
    if (enArr.length > CONFIG.statsHistoryPoints) enArr.shift();
  }

  // Push to charts.
  charts.pop.data.labels = history.labels;
  charts.energy.data.labels = history.labels;
  for (let i = 0; i < state.lineages.length; i++) {
    const lin = state.lineages[i];
    charts.pop.data.datasets[i].data = history.popByLin.get(lin.id);
    charts.energy.data.datasets[i].data = history.enByLin.get(lin.id);
  }
  charts.pop.update('none');
  charts.energy.update('none');

  // Deaths.
  charts.deaths.data.datasets[0].data = [w.deathsByCause.starvation || 0];
  charts.deaths.data.datasets[1].data = [w.deathsByCause.age || 0];
  charts.deaths.update('none');

  // Zone distribution. Phase 1 = single "open" bucket.
  const totals = state.lineages.map(l => popMap.get(l.id) || 0);
  charts.zone.data.datasets[0].data = [totals.reduce((a, b) => a + b, 0)];
  charts.zone.update('none');

  // Side metrics.
  document.getElementById('metric-alive').textContent = w.organisms.length;
  let totalGen = 0, count = 0;
  for (const o of w.organisms) { totalGen += o.generation; count++; }
  document.getElementById('metric-gen').textContent = (count ? totalGen / count : 0).toFixed(1);
}

// ---- Controls ----
function setupControls() {
  const pauseBtn = document.getElementById('btn-pause');
  const speedBtn = document.getElementById('btn-speed');
  const resetBtn = document.getElementById('btn-reset');

  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? 'play' : 'pause';
  });

  speedBtn.addEventListener('click', () => {
    state.speedIdx = (state.speedIdx + 1) % CONFIG.speedSteps.length;
    speedBtn.textContent = `${CONFIG.speedSteps[state.speedIdx]}x`;
  });

  resetBtn.addEventListener('click', () => {
    state.world.reset();
    state.world.seed();
    history.labels.length = 0;
    history.popByLin.clear();
    history.enByLin.clear();
  });
}

// ---- Boot ----
window.addEventListener('DOMContentLoaded', () => {
  // p5 instance mode — pinned to canvas-host so it never escapes the stage.
  new p5(sketch);
  setupControls();
  setupCharts();

  // HUD on rAF for smoothness; charts on a slower interval to avoid layout thrash.
  function hudLoop() { updateHud(); requestAnimationFrame(hudLoop); }
  hudLoop();
  setInterval(pushHistory, CONFIG.statsIntervalMs);
});
