import { CONFIG } from './config.js';

// Box-Muller. One sample per call is fine for our weight counts (~1k).
export function gaussianRandom() {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Glorot uniform — appropriate for tanh hidden layers.
function glorotUniform(fanIn, fanOut) {
  const bound = Math.sqrt(6 / (fanIn + fanOut));
  return (Math.random() * 2 - 1) * bound;
}

export function sigmoid(x) {
  // Clamp to avoid overflow at extreme magnitudes.
  if (x >  60) return 1;
  if (x < -60) return 0;
  return 1 / (1 + Math.exp(-x));
}

// Feedforward NN with tanh hidden layers and a linear output layer.
// The caller applies per-output activations (tanh / sigmoid / sigmoid) on top.
//
// Weights are stored in a single Float32Array, laid out per layer as
// [outNeuron][inNeuron..., bias] — i.e. each output row has (inSize + 1) entries.
// Flat storage keeps mutation tight (one pass over a contiguous buffer).
//
// Two "species" of brain coexist: organisms (46→5) and predators (22→3).
// The constructor accepts an `opts` object with optional `biasInit(weights,
// layers)` and `migrate(oldWeights, newLayers, totalNew)` overrides so each
// species plugs in its own logic without touching the other's path.
export class NeuralNet {
  constructor(layers = CONFIG.nnArchitecture, weights = null, opts = null) {
    this.layers = layers;
    this.layerOffsets = [];           // start index of each layer's weight block
    let total = 0;
    for (let i = 1; i < layers.length; i++) {
      this.layerOffsets.push(total);
      total += (layers[i - 1] + 1) * layers[i];
    }
    this.numWeights = total;
    this.opts = opts;

    const biasInit = (opts && opts.biasInit) || applyOutputBiasOverrides;
    const migrate  = (opts && opts.migrate)  || migrateWeights;

    if (weights && weights.length === total) {
      this.weights = weights;
    } else if (weights) {
      // Brain migration. Saved snapshots may carry a weight buffer from an
      // older architecture. Default organism path preserves vision overlap
      // + non-vision shift; predator path uses its own migration.
      this.weights = migrate(weights, layers, total);
    } else {
      this.weights = new Float32Array(total);
      let idx = 0;
      for (let i = 1; i < layers.length; i++) {
        const fanIn = layers[i - 1];
        const fanOut = layers[i];
        const blockSize = (fanIn + 1) * fanOut;
        for (let j = 0; j < blockSize; j++) {
          this.weights[idx++] = glorotUniform(fanIn, fanOut);
        }
      }
      biasInit(this.weights, layers);
    }

    // Pre-allocated activation buffers — reused across forward calls so we
    // avoid GC churn even with hundreds of agents ticking 60 times/sec.
    this.buffers = layers.map((n) => new Float32Array(n));
  }

  forward(input) {
    this.buffers[0].set(input);

    for (let layerIdx = 1; layerIdx < this.layers.length; layerIdx++) {
      const inSize = this.layers[layerIdx - 1];
      const outSize = this.layers[layerIdx];
      const inBuf = this.buffers[layerIdx - 1];
      const outBuf = this.buffers[layerIdx];
      const wBase = this.layerOffsets[layerIdx - 1];
      const isOutput = layerIdx === this.layers.length - 1;
      const stride = inSize + 1;

      for (let o = 0; o < outSize; o++) {
        let sum = 0;
        const row = wBase + o * stride;
        for (let i = 0; i < inSize; i++) sum += this.weights[row + i] * inBuf[i];
        sum += this.weights[row + inSize]; // bias
        outBuf[o] = isOutput ? sum : Math.tanh(sum);
      }
    }

    return this.buffers[this.buffers.length - 1];
  }

  clone() {
    return new NeuralNet(this.layers, new Float32Array(this.weights), this.opts);
  }

  // In-place mutation: each weight has `rate` probability of being perturbed
  // by a gaussian draw scaled by `sigma`.
  mutate(rate, sigma) {
    const w = this.weights;
    for (let i = 0; i < w.length; i++) {
      if (Math.random() < rate) w[i] += gaussianRandom() * sigma;
    }
  }
}

// Number of non-vision sensor slots (proprio + time + house + zone). Kept
// constant across architecture bumps; only the vision section's size has
// ever varied.
const NON_VISION_INPUTS = 10;

// After randomly-initialising a brain, tilt specific output biases so the
// behaviour starts in a known place. Currently only output[3] (poison) is
// pulled strongly negative so fresh brains emit ~nothing — emission has to
// be discovered by mutation rather than coming out of the box.
function applyOutputBiasOverrides(weights, layers) {
  const outIdx = 3;
  const lastLayer = layers.length - 1;
  if (lastLayer < 1 || layers[lastLayer] <= outIdx) return;
  let off = 0;
  for (let i = 1; i < lastLayer; i++) off += (layers[i - 1] + 1) * layers[i];
  const lastIn = layers[lastLayer - 1];
  const stride = lastIn + 1;
  weights[off + outIdx * stride + lastIn] = CONFIG.poisonInitBias;
}

// Builds a fresh weight buffer for `newLayers` and copies whatever it can
// from `oldWeights` according to the documented sensor layout (vision
// section first, then 10 fixed non-vision fields). Falls back to a plain
// overlap-copy + random tail when the old shape can't be inferred.
function migrateWeights(oldWeights, newLayers, totalNew) {
  const newIn = newLayers[0];
  const numH1 = newLayers[1];
  const numH2 = newLayers[2];
  const newOut = newLayers[3];
  const newL1 = (newIn + 1) * numH1;
  const newL2 = (numH1 + 1) * numH2;

  const out = new Float32Array(totalNew);

  // Try to infer the old architecture assuming only input count and output
  // count changed (hidden sizes preserved). Solve:
  //   oldL1 = (oldIn + 1) * numH1
  //   oldL3 = (numH2 + 1) * oldOut
  //   oldLen = oldL1 + newL2 + oldL3
  const oldLen = oldWeights.length;
  const remaining = oldLen - newL2;
  let oldIn = null;
  let oldOut = null;
  for (const tryOut of [4, 3, 2]) {
    const oldL3 = (numH2 + 1) * tryOut;
    const candL1 = remaining - oldL3;
    if (candL1 <= 0) continue;
    const candIn = candL1 / numH1 - 1;
    if (Number.isInteger(candIn) && candIn > 0) {
      oldIn = candIn;
      oldOut = tryOut;
      break;
    }
  }

  if (oldIn === null) {
    // Unknown shape — best-effort overlap copy + small-random tail.
    const overlap = Math.min(oldLen, totalNew);
    for (let i = 0; i < overlap; i++) out[i] = oldWeights[i];
    for (let i = overlap; i < totalNew; i++) out[i] = (Math.random() - 0.5) * 0.4;
    return out;
  }

  const oldStride = oldIn + 1;
  const newStride = newIn + 1;
  const oldVision = oldIn - NON_VISION_INPUTS;
  const newVision = newIn - NON_VISION_INPUTS;
  const addedVision = newVision - oldVision;
  const oldL2Off = oldStride * numH1;
  const newL2Off = newStride * numH1;

  // Layer 1: for each hidden neuron, lay out the new row as
  //   [old vision] [new vision slots, random] [old non-vision] [bias]
  for (let h = 0; h < numH1; h++) {
    const oldRow = h * oldStride;
    const newRow = h * newStride;
    for (let i = 0; i < oldVision; i++) {
      out[newRow + i] = oldWeights[oldRow + i];
    }
    for (let i = 0; i < addedVision; i++) {
      out[newRow + oldVision + i] = (Math.random() - 0.5) * 0.4;
    }
    for (let i = 0; i < NON_VISION_INPUTS; i++) {
      out[newRow + newVision + i] = oldWeights[oldRow + oldVision + i];
    }
    out[newRow + newIn] = oldWeights[oldRow + oldIn]; // bias
  }

  // Layer 2: structure unchanged, copy verbatim.
  for (let i = 0; i < newL2; i++) {
    out[newL2Off + i] = oldWeights[oldL2Off + i];
  }

  // Layer 3: copy outputs that exist in both, init new ones.
  const oldL3Off = oldL2Off + newL2;
  const newL3Off = newL2Off + newL2;
  const outStride = numH2 + 1;
  const sharedOut = Math.min(oldOut, newOut);
  for (let o = 0; o < sharedOut; o++) {
    for (let i = 0; i < outStride; i++) {
      out[newL3Off + o * outStride + i] = oldWeights[oldL3Off + o * outStride + i];
    }
  }
  for (let o = oldOut; o < newOut; o++) {
    for (let i = 0; i < outStride; i++) {
      out[newL3Off + o * outStride + i] = (Math.random() - 0.5) * 0.4;
    }
    // Mirror the random-init pathway: bias output[3] (poison) to silent
    // start instead of leaving it at small random.
    if (o === 3) {
      out[newL3Off + o * outStride + (outStride - 1)] = CONFIG.poisonInitBias;
    }
  }

  return out;
}

// ── Predator-specific brain init ─────────────────────────────────────────
// The predator brain is a separate species from the organism one. It uses
// a different input layout (22 inputs, 8 vision rays × 2 channels, no
// food/house/time), a different output count (3), and starts with two
// initialisation tilts so a fresh random brain isn't useless:
//   1. out[1] (speed) bias positive → predators cruise instead of idling.
//   2. out[2] (reproduce) bias strongly negative → no spawn-on-create.
// On top of that, a small hand-seeded "prey reflex" injects a left/right
// turn-toward-prey response so v0 predators visibly chase prey from frame
// one. Mutation can erase any of these tilts if they stop being useful.

export function applyPredatorOutputBiasOverrides(weights, layers) {
  const lastLayer = layers.length - 1;
  if (lastLayer < 1) return;
  const lastIn = layers[lastLayer - 1];
  const stride = lastIn + 1;
  let off = 0;
  for (let i = 1; i < lastLayer; i++) off += (layers[i - 1] + 1) * layers[i];
  // out[1] = speed
  if (layers[lastLayer] > 1) {
    weights[off + 1 * stride + lastIn] = CONFIG.predatorSpeedInitBias;
  }
  // out[2] = reproduce
  if (layers[lastLayer] > 2) {
    weights[off + 2 * stride + lastIn] = CONFIG.predatorReproInitBias;
  }
}

// Bias the brain toward turning into prey on sight. Vision is laid out as
// rayCount × 2 (distance, type), with the type channel at index 2r+1. Left
// half of rays (those covering the predator's left-front quadrant) feed
// hidden neuron h_L positively; right half feeds h_R. h_L pushes out[0]
// positive (turn left ≡ +1 by tanh convention), h_R pushes out[0] negative.
//
// The two hidden neurons used are picked deterministically (indices 0 and
// 1 of layer 1). They overlap with whatever Glorot init produced, but the
// magnitudes here dominate the random ~0.3 stddev draws.
export function seedPreyReflex(weights, layers) {
  if (layers.length < 4) return;
  const rays = CONFIG.predatorVisionRays | 0;
  if (rays < 4) return;
  const numIn = layers[0];
  const numH1 = layers[1];
  const numH2 = layers[2];
  const numOut = layers[3];
  if (numH1 < 2 || numOut < 1) return;

  const layer1Stride = numIn + 1;
  const layer2Stride = numH1 + 1;
  const layer3Stride = numH2 + 1;
  const layer1Off = 0;
  const layer2Off = layer1Stride * numH1;
  const layer3Off = layer2Off + layer2Stride * numH2;

  const strength = CONFIG.predatorPreyReflexStrength;
  const PREY = 0.35;  // matches PRED_SENSOR_TYPES.PREY
  // We want the hidden neuron to fire when type channel ≈ PREY. Type input
  // is fed raw [0..1]; a weight of `strength` here is fine.

  // Decide left vs right by ray index. Ray 0 is forward, then they go around.
  // With rayCount=8 at 45° steps from heading: rays 1..3 are right-front-
  // ish, rays 5..7 are left-front-ish (in screen coords where +y is down).
  // We don't need to be exact — the network can refine. Split the circle
  // roughly into two halves around the forward direction:
  //   right half: rays where index is in (0, rays/2)
  //   left half:  rays where index is in (rays/2, rays)
  // Ray 0 (forward) feeds both equally so it doesn't bias either way.
  const halfL = 0;  // hidden neuron 0
  const halfR = 1;  // hidden neuron 1
  for (let r = 0; r < rays; r++) {
    const typeIdx = r * 2 + 1;
    if (r > 0 && r < rays / 2) {
      // right half → h_R
      weights[layer1Off + halfR * layer1Stride + typeIdx] = strength;
    } else if (r > rays / 2) {
      // left half → h_L
      weights[layer1Off + halfL * layer1Stride + typeIdx] = strength;
    }
  }
  // Tilt biases so the hidden neurons sit just below firing for non-prey
  // type-codes (most ≤ 0.6) but cross threshold when PREY (~0.35) appears
  // on multiple rays. Bias = -0.5 * strength keeps the neuron near zero
  // when nothing relevant is seen.
  weights[layer1Off + halfL * layer1Stride + numIn] = -0.3 * strength;
  weights[layer1Off + halfR * layer1Stride + numIn] = -0.3 * strength;

  // Route h_L and h_R through layer 2 into a single layer-2 neuron 0 so
  // there's a clear path to the output. Use neuron 0 of layer 2 as the
  // turn-steering aggregator.
  const turnAgg = 0;
  if (numH2 > 0) {
    weights[layer2Off + turnAgg * layer2Stride + halfL] = strength;
    weights[layer2Off + turnAgg * layer2Stride + halfR] = -strength;
    // bias near zero
    weights[layer2Off + turnAgg * layer2Stride + numH1] = 0;

    // Route layer-2 neuron `turnAgg` into out[0] positively.
    weights[layer3Off + 0 * layer3Stride + turnAgg] = strength;
  }
}

// Predator brain migration. Saved snapshots from earlier versions don't
// have predator brains at all (handled in storage.js), so this only fires
// when the predator architecture itself is bumped in a future release.
// Approach: best-effort overlap copy then random-fill the tail; re-apply
// the bias overrides + reflex seed on top so newly-added outputs land in
// sensible places.
export function migratePredatorWeights(oldWeights, newLayers, totalNew) {
  const out = new Float32Array(totalNew);
  const overlap = Math.min(oldWeights.length, totalNew);
  for (let i = 0; i < overlap; i++) out[i] = oldWeights[i];
  for (let i = overlap; i < totalNew; i++) out[i] = (Math.random() - 0.5) * 0.4;
  applyPredatorOutputBiasOverrides(out, newLayers);
  return out;
}

// Default opts bundle for predator NeuralNet construction. Pass to the
// NeuralNet constructor: new NeuralNet(arch, weights, PREDATOR_NN_OPTS).
export const PREDATOR_NN_OPTS = {
  biasInit(weights, layers) {
    applyPredatorOutputBiasOverrides(weights, layers);
    seedPreyReflex(weights, layers);
  },
  migrate: migratePredatorWeights,
};
