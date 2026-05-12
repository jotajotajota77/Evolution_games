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

    if (weights) {
      this.weights = weights;
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
