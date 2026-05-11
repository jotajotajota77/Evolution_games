import { CONFIG } from './config.js';

// id=0 is reserved for the auto-seeded default lineage from earlier phases.
let nextLineageId = 1;

// A lineage is a group of organisms that share a reproduction tree, a colour,
// and (once placed) a home. The `house` reference is populated by world.addHouse.
export class Lineage {
  constructor(id, name, color) {
    this.id = id;
    this.name = name;
    this.color = color;   // [r, g, b]
    this.houseId = null;  // set when this lineage's house is placed
    this.house = null;    // direct ref for hot sensor lookups
  }
}

export function createLineage(name, color) {
  return new Lineage(nextLineageId++, name, color);
}

// Suggests the next-best palette colour not yet used by any lineage in the
// provided iterable. Falls back to the first palette entry if all are taken.
export function suggestNextLineageDefaults(existingLineages) {
  const usedRgb = new Set();
  for (const lin of existingLineages) {
    usedRgb.add(lin.color.join(','));
  }
  for (let i = 0; i < CONFIG.lineagePalette.length; i++) {
    const entry = CONFIG.lineagePalette[i];
    if (!usedRgb.has(entry.rgb.join(','))) {
      return { name: entry.name, color: entry.rgb };
    }
  }
  // All palette colours used — recycle the first.
  const fallback = CONFIG.lineagePalette[0];
  return { name: fallback.name, color: fallback.rgb };
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('');
}

export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
