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
// The organism applies per-output activations (tanh / sigmoid / sigmoid) on top.
//
// Weights are stored in a single Float32Array, laid out per layer as
// [outNeuron][inNeuron..., bias] — i.e. each output row has (inSize + 1) entries.
// Flat storage keeps mutation tight (one pass over a contiguous buffer).
export class NeuralNet {
  constructor(layers = CONFIG.nnArchitecture, weights = null) {
    this.layers = layers;
    this.layerOffsets = [];           // start index of each layer's weight block
    let total = 0;
    for (let i = 1; i < layers.length; i++) {
      this.layerOffsets.push(total);
      total += (layers[i - 1] + 1) * layers[i];
    }
    this.numWeights = total;

    if (weights && weights.length === total) {
      this.weights = weights;
    } else if (weights) {
      // Brain migration. Saved snapshots may carry a weight buffer from an
      // older architecture. v1.35 made this layout-aware:
      //   - infers the old input count + output count from the buffer size
      //     (assumes hidden layers stayed the same)
      //   - preserves the old vision section verbatim (8 rays → first 24
      //     slots in the new layout)
      //   - shifts the non-vision section (10 fields) right by the number
      //     of added vision slots so proprio/time/house/zone land in the
      //     right new positions
      //   - small-random-inits the *new* vision slots and any added output
      //     neurons so they start near zero and evolve via mutation
      this.weights = migrateWeights(weights, layers, total);
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
    }

    // Pre-allocated activation buffers — reused across forward calls so we
    // avoid GC churn even with hundreds of organisms ticking 60 times/sec.
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
    return new NeuralNet(this.layers, new Float32Array(this.weights));
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
  }

  return out;
}
