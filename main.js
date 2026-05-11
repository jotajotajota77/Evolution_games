import { CONFIG } from './config.js';
import { World } from './world.js';
import {
  attachP5, rebuildVignette, drawTrailFade,
  drawFood, drawOrganisms, drawHouses, drawHousePreview,
  drawVignette, paintBackground,
} from './renderer.js';
import { createLineage, suggestNextLineageDefaults } from './lineage.js';
import { House } from './house.js';
import {
  setTool, getTool, isModalOpen, onPlaceHouse, onToolChange,
  onMouseDown, onMouseMove, onMouseUp, getDrag,
} from './tools.js';
import { showHouseModal } from './ui.js';

// ---- runtime state ----
const state = {
  world: null,
  paused: false,
  speedIdx: 0,
  lastFrameMs: 0,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
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

  // Mouse / touch routed to the tools module. p5 fires these for the whole
  // window — we gate by canvas bounds to avoid placing houses while clicking
  // the side panel or toolbar.
  const inCanvas = () =>
    p.mouseX >= 0 && p.mouseX <= p.width &&
    p.mouseY >= 0 && p.mouseY <= p.height;

  p.mousePressed = () => {
    if (!inCanvas() || isModalOpen()) return;
    onMouseDown(p.mouseX, p.mouseY);
  };
  p.mouseDragged = () => {
    if (isModalOpen()) return;
    onMouseMove(p.mouseX, p.mouseY);
  };
  p.mouseReleased = () => {
    if (isModalOpen()) return;
    onMouseUp(p.mouseX, p.mouseY);
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
      const subSteps = Math.min(8, Math.max(1, Math.ceil(speed)));
      const dt = (realDt * speed) / subSteps;
      for (let i = 0; i < subSteps; i++) state.world.update(dt);
    }

    drawTrailFade();
    drawHouses(state.world);
    drawFood(state.world);
    drawOrganisms(state.world);
    drawHousePreview(getDrag());
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
  document.getElementById('hud-gen').textContent = w.maxGenerationSeen || 0;
  const total = Math.floor(w.tickSec);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  document.getElementById('hud-time').textContent = `${mm}:${ss}`;
}

// ---- Charts (Chart.js) ----
const charts = {};

function chartTheme() {
  return { color: '#8a8aa0', grid: '#1f1f2e', axis: '#2a2a3a' };
}

function makeLineChart(canvasId) {
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
        x: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
             grid: { color: t.grid, drawTicks: false }, border: { color: t.axis } },
        y: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
             grid: { color: t.grid, drawTicks: false }, border: { color: t.axis }, beginAtZero: true },
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
        x: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' } },
             grid: { display: false }, border: { color: t.axis }, stacked: true },
        y: { ticks: { color: t.color, font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 4 },
             grid: { color: t.grid, drawTicks: false }, border: { color: t.axis }, stacked: true, beginAtZero: true },
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

  // Seed line charts with the default lineage. Other lineages are added at
  // creation time so the legend/colors stay correct.
  for (const lin of state.world.lineages.values()) addLineageToCharts(lin);

  charts.deaths.data.labels = ['deaths'];
  charts.deaths.data.datasets = [
    { label: 'starvation', data: [0], backgroundColor: '#ff6b6b' },
    { label: 'age',        data: [0], backgroundColor: '#7fa9ff' },
  ];

  refreshZoneChart();
}

// Adds a new lineage's series to the line charts. Pad the data array with
// nulls so the line starts at "now" instead of at the chart's left edge.
function addLineageToCharts(lin) {
  const color = rgbToCss(lin.color);
  const padLen = history.labels.length;
  const padArr = () => new Array(padLen).fill(null);

  charts.pop.data.datasets.push({
    label: lin.name, data: padArr(),
    borderColor: color, backgroundColor: rgbToCss(lin.color, 0.12), fill: true,
  });
  charts.energy.data.datasets.push({
    label: lin.name, data: padArr(),
    borderColor: color, backgroundColor: rgbToCss(lin.color, 0.12), fill: false,
  });
  history.popByLin.set(lin.id, padArr());
  history.enByLin.set(lin.id, padArr());

  charts.pop.update('none');
  charts.energy.update('none');
}

// Rebuilds the zone bar chart so each lineage gets a colored slot, plus an
// "open" bucket for organisms outside every house.
function refreshZoneChart() {
  const w = state.world;
  const labels = ['open', ...[...w.lineages.values()].filter(l => l.house).map(l => l.name)];
  const colors = ['#3a3a4a', ...[...w.lineages.values()].filter(l => l.house).map(l => rgbToCss(l.color, 0.7))];
  charts.zone.data.labels = labels;
  charts.zone.data.datasets = [{ data: new Array(labels.length).fill(0), backgroundColor: colors }];
  charts.zone.update('none');
}

const history = {
  labels: [],
  popByLin: new Map(),
  enByLin: new Map(),
};

function pushHistory() {
  const w = state.world;
  if (!w) return;

  const t = Math.floor(w.tickSec);
  history.labels.push(`${t}s`);
  if (history.labels.length > CONFIG.statsHistoryPoints) history.labels.shift();

  const popMap = new Map();
  const sumE = new Map();
  for (const lin of w.lineages.values()) { popMap.set(lin.id, 0); sumE.set(lin.id, 0); }
  for (const o of w.organisms) {
    popMap.set(o.lineageId, (popMap.get(o.lineageId) || 0) + 1);
    sumE.set(o.lineageId, (sumE.get(o.lineageId) || 0) + o.energy);
  }

  let datasetIdx = 0;
  for (const lin of w.lineages.values()) {
    const pop = popMap.get(lin.id) || 0;
    const avgE = pop > 0 ? sumE.get(lin.id) / pop : 0;

    const popArr = history.popByLin.get(lin.id);
    const enArr = history.enByLin.get(lin.id);
    popArr.push(pop);
    enArr.push(avgE);
    if (popArr.length > CONFIG.statsHistoryPoints) popArr.shift();
    if (enArr.length > CONFIG.statsHistoryPoints) enArr.shift();

    charts.pop.data.datasets[datasetIdx].data = popArr;
    charts.energy.data.datasets[datasetIdx].data = enArr;
    datasetIdx++;
  }
  charts.pop.data.labels = history.labels;
  charts.energy.data.labels = history.labels;
  charts.pop.update('none');
  charts.energy.update('none');

  charts.deaths.data.datasets[0].data = [w.deathsByCause.starvation || 0];
  charts.deaths.data.datasets[1].data = [w.deathsByCause.age || 0];
  charts.deaths.update('none');

  // Zone distribution: organisms in each house's zone, with the rest in "open".
  const housedLineages = [...w.lineages.values()].filter(l => l.house);
  const counts = new Array(1 + housedLineages.length).fill(0);
  for (const o of w.organisms) {
    let placed = false;
    for (let i = 0; i < housedLineages.length; i++) {
      if (housedLineages[i].house.contains(o.x, o.y)) { counts[1 + i]++; placed = true; break; }
    }
    if (!placed) counts[0]++;
  }
  charts.zone.data.datasets[0].data = counts;
  charts.zone.update('none');

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
    history.labels.length = 0;
    for (const arr of history.popByLin.values()) arr.length = 0;
    for (const arr of history.enByLin.values()) arr.length = 0;
    state.world.deathsByCause.starvation = 0;
    state.world.deathsByCause.age = 0;
  });
}

// ---- Toolbar ----
function setupToolbar() {
  const buttons = document.querySelectorAll('#toolbar .tool');
  buttons.forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  onToolChange((name) => {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
    document.body.classList.toggle('placing', name === 'house');
  });
}

// ---- House placement flow ----
function handlePlaceHouse(x, y, radius) {
  // Auto-revert to select so a single click doesn't immediately stage another
  // house if the user doesn't want to.
  const w = state.world;
  const suggested = suggestNextLineageDefaults(w.lineages.values());
  showHouseModal(
    suggested,
    (data) => {
      const lineage = createLineage(data.name, data.color);
      w.addLineage(lineage);
      const house = new House(x, y, radius, lineage.id,
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
      );
      w.addHouse(house);
      w.seedFoundersForHouse(house, data.founders);
      addLineageToCharts(lineage);
      refreshZoneChart();
      setTool('select');
    },
    () => setTool('select'),
  );
}

// ---- Boot ----
window.addEventListener('DOMContentLoaded', () => {
  new p5(sketch);
  setupControls();
  setupToolbar();
  onPlaceHouse(handlePlaceHouse);

  // Wait until the world is ready (p5.setup runs on first frame), then build charts.
  const waitForWorld = () => {
    if (state.world) { setupCharts(); return; }
    requestAnimationFrame(waitForWorld);
  };
  waitForWorld();

  const v = document.getElementById('app-version');
  if (v) v.textContent = CONFIG.version;

  function hudLoop() { updateHud(); requestAnimationFrame(hudLoop); }
  hudLoop();
  setInterval(() => { if (charts.pop) pushHistory(); }, CONFIG.statsIntervalMs);
});
