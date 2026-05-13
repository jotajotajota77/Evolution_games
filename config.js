// Global tunables. Phase-specific values are commented; later phases will add more.
export const CONFIG = {
  // Bump this on every commit. Shown discreetly in the panel footer.
  version: 'v1.34',

  // World
  worldPadding: 0,                  // canvas fills the stage; world == canvas size
  // Sky colors at noon vs midnight — exaggerated for a clear day/night feel.
  worldBgDay:   [22, 32, 56],
  worldBgNight: [2, 3, 9],
  // Per-frame trail-fade alpha (0..255). Higher = faster fade. v1.26 raised
  // this from 38 to 110 because long-running sims were leaving heavy
  // permanent smears on the canvas; the gentle motion-blur look is now
  // restricted to a couple of frames.
  trailFadeAlpha: 110,
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

  // Default lineage. `name` is generated fresh at world construction (via
  // randomBinomial()) so the literal "default" never appears in the UI.
  defaultLineage: {
    id: 0,
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
  // v1.28: output 4 added (poison emission). Saved brains from older versions
  // are migrated on load — the new output neuron's weights are small-random
  // so it starts ~neutral and evolves through normal mutation.
  nnArchitecture: [34, 20, 14, 4],

  // Sensors / vision
  visionRays: 8,
  visionFanRad: (120 * Math.PI) / 180, // ~2.094 rad fan in front of organism
  visionRange: 110,                    // px

  // Reproduction (asexual, via NN intent + energy threshold)
  reproductionEnergyThresh: 0.8,    // fraction of organismMaxEnergy
  reproductionIntentThresh: 0.6,    // sigmoid output threshold
  mutationRate: 0.06,               // probability per weight (when a birth IS mutated)
  mutationSigma: 0.18,              // gaussian std-dev for mutation
  // Per-birth mutation gate. 1.0 = every child gets weight mutations (current
  // default). 0.0 = no child ever mutates (pure clone). Tunable live from
  // the settings popup. When the gate doesn't trigger the child is also
  // skipped from colour-drift accumulation — drift only happens with mutation.
  mutationEventChance: 1.0,
  maxPopulation: 400,               // hard cap; reproduction blocked at cap
  childOffsetMax: 6,                // px from parent on birth

  // Per-individual colour drift accumulated across generations. The renderer
  // mixes the lineage base colour with the drift before drawing, so over
  // many generations descendants visibly diverge from their lineage hue.
  colorDriftSigma: 9,               // gaussian std-dev (per channel, per birth)
  colorDriftMax: 120,               // clamp |drift| per channel (0-255 scale)

  // Phylogeny tracker (v1.17+). Periodically the world looks at each species
  // and, if the population's drift variance is high enough AND the species
  // is old enough AND each candidate child cluster has a reasonable size,
  // splits it. The thresholds below exist so tiny or short-lived sub-
  // clusters don't pollute the tree. Tightened in v1.24 after observing
  // noisy trees with single-individual extinctions.
  // Speciation criteria — looser than v1.24 so descendant species can also
  // speciate further (canopy grows beyond a single split layer); the
  // display filter (peakPop + lifespan) is what guards pollution.
  phyloCheckIntervalSec: 4,
  phyloMinAgeSec: 14,               // a species must live this long before splitting
  phyloMinChildPop: 8,              // each child cluster must have >= this many orgs
  phyloSplitStdThreshold: 22,       // total stddev of drift triggering a split
  phyloMinDisplayPeakPop: 8,        // chart hides species that never reached this
  phyloMinDisplayLifespanSec: 12,   // extinct species must have lived this long to render

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

  // Poison (v1.29). The 4th NN output drives a CONTINUOUS gas trail —
  // higher sigmoid(out[3]) means more puffs per second and more energy
  // burned per second. There is no on/off gate or cooldown; an organism
  // that holds out[3] near 1 will starve itself.
  poisonNoiseFloor: 0.08,          // intent below this leaves no trail (silences NN babble)
  poisonCostPerSec: 30,            // energy/sec at full intent (intent=1)
  poisonEmitsPerSec: 14,           // puffs/sec at full intent — dense spacing makes the trail look smooth
  poisonDurationSec: 1.6,          // each puff's lifespan
  poisonRadius: 12,                // baseline puff radius (sprite scales it; collision radius too)
  // v1.32: poison now SLOWS predators (no longer hard-paralysis). They keep
  // moving + hunting at a fraction of their speed.
  predatorPoisonedDurationSec: 3,  // how long the slow effect lasts after last contact
  predatorPoisonSlowFactor: 0.18,  // current speed multiplier while poisoned
  poisonColor: [170, 255, 110],    // toxic green (smoke)
  predatorPoisonedColor: [225, 255, 35],  // vivid lime-yellow tint for poisoned predators

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
