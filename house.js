let nextHouseId = 1;

export function ensureNextHouseId(min) {
  if (min > nextHouseId) nextHouseId = min;
}

// A house combines a circular zone (alters food density + energy decay locally)
// with an automatic circular barrier permeable to the lineages listed in
// `allowedLineages`. Organisms whose lineage isn't allowed bounce off the
// perimeter and lose a small amount of energy on contact.
export class House {
  constructor(x, y, radius, lineageId, zoneConfig, barrierConfig, allowedLineages) {
    this.id = nextHouseId++;
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.lineageId = lineageId;
    this.zone = { ...zoneConfig };
    this.barrier = { ...barrierConfig };
    // Always allow the home lineage. Extra lineages may be added by the user
    // through the placement modal.
    this.allowedLineages = new Set(allowedLineages || []);
    this.allowedLineages.add(lineageId);
    this.foodSpawnAccumulator = 0;
    // Snapshot of the food density at construction so persistence respawn
    // can restore it after a gradual-reduction wind-down. Updated whenever
    // the user explicitly re-baselines via the edit modal.
    this.foodDensityInitial = zoneConfig.foodDensity;
  }

  isAllowed(lineageId) {
    return this.allowedLineages.has(lineageId);
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
