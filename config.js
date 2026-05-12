// Global tunables. Phase-specific values are commented; later phases will add more.
export const CONFIG = {
  // Bump this on every commit. Shown discreetly in the panel footer.
  version: 'v1.13',

  // World
  worldPadding: 0,                  // canvas fills the stage; world == canvas size
  // Sky colors at noon vs midnight — exaggerated for a clear day/night feel.
  worldBgDay:   [22, 32, 56],
  worldBgNight: [2, 3, 9],
  trailFade:    'rgba(10, 10, 20, 0.15)', // legacy; renderer uses sky color now
  nightDimAlpha: 0.55,               // strength of per-frame night overlay at midnight

  // Time / loop
  targetFps: 60,
  speedSteps: [0.5, 1, 5, 10, 20],  // selectable from the "world" popup
  defaultSpeedIdx: 1,               // start at 1x

  // Day/night cycle
  dayLengthSec: 90,                 // sim-seconds per full day
  // dayPhase 0 = midnight, 0.5 = noon. We start the world at noon so the
  // initial population doesn't immediately face night-rate decay.
  startAtNoon: true,

  // Food
  foodSpawnRatePerSec: 14,          // global uniform spawn (no zones yet)
  foodMaxCount: 700,                // hard cap to keep canvas readable
  foodEnergy: 28,                   // energy gained on eat
  foodRadius: 3,
  foodColor: [127, 255, 212],       // #7fffd4

  // Organism
  initialPopulation: 80,
  organismRadius: 4,
  organismMaxSpeed: 1.6,            // px / frame at speed 1
  organismTurnRate: 0.18,           // radians / frame max change (random walk)
  organismStartEnergy: 70,
  organismMaxEnergy: 100,
  organismEnergyDecayPerSec: 4,     // base decay
  organismEnergyDecayMoveMult: 1.6, // scales with normalized speed
  organismMaxAgeSec: 90,            // soft ceiling so populations cycle
  organismEatRadius: 6,             // distance at which food is consumed
  organismNightDecayBonus: 0.6,     // extra decay at full night when outside own house

  // Default lineage (phase 1 only has this one)
  defaultLineage: {
    id: 0,
    name: 'default',
    hue: 210,                       // soft blue
    color: [127, 169, 255],         // #7fa9ff
  },

  // Visuals
  glowOrganism: 8,                  // shadowBlur in px
  glowFood: 6,
  vignetteStrength: 0.55,           // 0..1

  // Stats
  statsIntervalMs: 1000,
  statsHistoryPoints: 60,           // 60s of history

  // Neural network — fixed across all phases so the same architecture survives
  // when later phases activate the currently-zeroed sensors.
  nnArchitecture: [34, 20, 14, 3],

  // Sensors / vision
  visionRays: 8,
  visionFanRad: (120 * Math.PI) / 180, // ~2.094 rad fan in front of organism
  visionRange: 110,                    // px

  // Reproduction (asexual, via NN intent + energy threshold)
  reproductionEnergyThresh: 0.8,    // fraction of organismMaxEnergy
  reproductionIntentThresh: 0.6,    // sigmoid output threshold
  mutationRate: 0.06,               // probability per weight
  mutationSigma: 0.18,              // gaussian std-dev for mutation
  maxPopulation: 400,               // hard cap; reproduction blocked at cap
  childOffsetMax: 6,                // px from parent on birth

  // Lineage palette — used as default colors when the user creates new lineages.
  // Each entry suggests a name and an RGB triple. Users may pick any custom color.
  lineagePalette: [
    { name: 'rose',   rgb: [255, 127, 200] },
    { name: 'amber',  rgb: [255, 200, 100] },
    { name: 'mint',   rgb: [127, 230, 160] },
    { name: 'violet', rgb: [200, 140, 255] },
    { name: 'coral',  rgb: [255, 150, 110] },
    { name: 'cyan',   rgb: [120, 220, 230] },
    { name: 'lemon',  rgb: [230, 230, 130] },
  ],

  // House defaults — pre-filled into the placement modal.
  // foodDensity is given per 100x100-px "tile" of area so the number stays
  // human-readable. The world converts it to a per-second rate using house area.
  houseDefaults: {
    founders: 20,
    foodDensity: 3.0,
    foodEnergy: 32,
    decayMultiplier: 0.7,
    predatorsAllowed: true,
    transparentFromInside: false,
    transparentFromOutside: false,
  },

  // Placement tool constraints.
  houseMinRadius: 30,
  houseMaxRadius: 220,
  zoneMinRadius: 30,
  zoneMaxRadius: 260,

  // Barrier (free-drawn) defaults
  barrierMinLength: 18,             // px; below this, drag is ignored
  barrierDefaults: {
    color: [220, 180, 90],
    thickness: 4,
    transparentFromSideA: false,
    transparentFromSideB: false,
  },

  // Zone (non-house) defaults — pre-filled into the zone placement modal.
  // Zones with an empty allowedLineages set are open to everyone (spec
  // default: "Acessível a qualquer organismo por padrão").
  zoneDefaults: {
    color: [148, 132, 200],
    foodDensity: 1.2,
    foodEnergy: 30,
    decayMultiplier: 1.0,
    predatorsAllowed: true,
  },

  // Energy lost on collision with a zone the organism's lineage isn't
  // allowed into. Small enough that occasional bumps don't kill, big
  // enough to discourage pressing against the boundary.
  barrierHitEnergyCost: 0.6,

  // Predators (phase 7). Scripted agents that pursue the nearest organism.
  // House barriers always exclude them; zones with predatorsAllowed=false
  // bounce them out.
  predatorRadius: 6,
  predatorMaxSpeed: 2.2,             // faster than organism's 1.6
  predatorTurnRate: 0.14,            // rad/frame at 60fps
  predatorSenseRange: 160,
  predatorEatRadius: 9,
  predatorStartEnergy: 60,
  predatorEnergyDecayPerSec: 2.0,
  predatorEnergyPerKill: 55,
  // No max-energy cap and no eat cooldown — predators can chain kills and
  // accumulate reserves freely.

  // Spatial hashing (phase 8). Cell size near the largest query radius so
  // each lookup touches O(1) cells regardless of population.
  spatialCellSize: 90,

  // UI fade behaviour (configurable via the "config" popup slider).
  uiAutohideThreshold: 95,          // slider %; above this, auto-hide kicks in
  uiAutohideDelayMs: 2000,          // after closing settings, peek → hide
  uiPeekDelayMs: 3000,              // after click, peek → hide again
  uiPeekAlpha: 0.05,                // alpha while peeking in auto-hide mode
};
