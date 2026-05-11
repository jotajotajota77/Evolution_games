let nextHouseId = 1;

// A house combines a circular zone (alters food density + energy decay locally)
// with an automatic circular barrier (visual only in phase 3; permeable to
// the house's lineage and enforced in phase 6 onward).
export class House {
  constructor(x, y, radius, lineageId, zoneConfig, barrierConfig) {
    this.id = nextHouseId++;
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.lineageId = lineageId;
    this.zone = { ...zoneConfig };
    this.barrier = { ...barrierConfig };
    this.foodSpawnAccumulator = 0;
  }

  contains(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }

  area() {
    return Math.PI * this.radius * this.radius;
  }
}

// Uniform sample inside a disk: sqrt(r) gives equal area-density.
export function sampleInCircle(cx, cy, radius) {
  const angle = Math.random() * Math.PI * 2;
  const r = radius * Math.sqrt(Math.random());
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}
