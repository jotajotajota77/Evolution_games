let nextZoneId = 1;

// A non-house zone: a circular region with its own food density / food energy
// / decay multiplier, and an optional access list. Unlike houses, zones have
// no automatic barrier and no associated lineage. With an empty
// `allowedLineages` set the zone is open to everyone (the default).
export class Zone {
  constructor(x, y, radius, color, zoneConfig, allowedLineages) {
    this.id = nextZoneId++;
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.color = [...color];
    this.zone = { ...zoneConfig };
    this.allowedLineages = new Set(allowedLineages || []);
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

  // Empty set = open zone. Otherwise only listed lineages may enter.
  isAllowed(lineageId) {
    if (this.allowedLineages.size === 0) return true;
    return this.allowedLineages.has(lineageId);
  }
}
