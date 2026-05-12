// Uniform spatial grid for fast proximity queries. Each tick the world
// rebuilds three of these (food / organisms / predators) and the heavy
// loops — vision, predator targeting, food eating — query a small subset
// instead of scanning the whole array.
//
// Pick a cell size near the largest typical query radius (vision range ≈ 110,
// predator sense ≈ 160). With a 90-px cell each vision query touches ≈ 9
// cells worth of entities — a tiny fraction of a populated world.
export class SpatialGrid {
  constructor(width, height, cellSize) {
    this.cellSize = cellSize;
    this._resize(width, height);
  }

  resize(width, height) {
    this._resize(width, height);
  }

  _resize(width, height) {
    this.cols = Math.max(1, Math.ceil(width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(height / this.cellSize));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear() {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
  }

  rebuild(entities) {
    this.clear();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(e.x / this.cellSize)));
      const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(e.y / this.cellSize)));
      this.cells[cy * this.cols + cx].push(e);
    }
  }

  // Returns a fresh array of every entity whose cell intersects the bbox of
  // (x, y, radius). Caller still does an exact distance check — this is a
  // broad-phase filter.
  queryRadius(x, y, radius) {
    const cs = this.cellSize;
    const minCx = Math.max(0, Math.floor((x - radius) / cs));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / cs));
    const minCy = Math.max(0, Math.floor((y - radius) / cs));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / cs));
    const out = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOff = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.cells[rowOff + cx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}
