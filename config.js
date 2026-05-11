// Global tunables. Phase-specific values are commented; later phases will add more.
export const CONFIG = {
  // Bump this on every commit. Shown discreetly in the panel footer.
  version: 'v1.2',

  // World
  worldPadding: 0,                  // canvas fills the stage; world == canvas size
  worldBgDay:   [12, 16, 28],
  worldBgNight: [6, 8, 16],         // used in phase 4
  trailFade:    'rgba(10, 10, 20, 0.15)', // overlay per frame to leave organism trails

  // Time / loop
  targetFps: 60,
  speedSteps: [1, 2, 5, 20],        // controls cycle through these

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
};
