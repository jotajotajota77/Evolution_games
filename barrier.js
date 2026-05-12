let nextBarrierId = 1;

// A barrier is a polyline (array of points) with per-side visibility and a
// per-lineage permeability list. In v1 we only place 2-point segments via
// click+drag, but the data model supports polylines for a future polish pass.
//
// Side convention — for a segment from p1 to p2:
//   cross = (p2.x - p1.x) * (q.y - p1.y) - (p2.y - p1.y) * (q.x - p1.x)
//   cross > 0  → side A (call it the "left" side of the p1→p2 walk)
//   cross < 0  → side B
//
// transparentFromSideA = true  → rays cast from a point on side A pass through
// transparentFromSideB = true  → rays cast from a point on side B pass through
//
// An opaque barrier (from this side) is recorded in vision with type=BARRIER
// and passable = isAllowed(lineageId). A transparent barrier is invisible to
// the sensors entirely (the ray continues past it).
export class Barrier {
  constructor(points, opts = {}) {
    this.id = nextBarrierId++;
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    this.thickness = opts.thickness ?? 4;
    this.color = opts.color ? [...opts.color] : [220, 180, 90];
    this.allowedLineages = new Set(opts.allowedLineages || []);
    this.transparentFromSideA = !!opts.transparentFromSideA;
    this.transparentFromSideB = !!opts.transparentFromSideB;
  }

  isAllowed(lineageId) {
    return this.allowedLineages.has(lineageId);
  }
}

// Positive when q is on side A of segment p1→p2, negative on side B, 0 on the line.
export function segmentSide(p1, p2, q) {
  return (p2.x - p1.x) * (q.y - p1.y) - (p2.y - p1.y) * (q.x - p1.x);
}

// Standard 2D segment-segment intersection test (proper crossings only, no
// collinear overlap). Used by collision logic to detect when an organism's
// step crossed a barrier segment.
export function segmentsCross(a1, a2, b1, b2) {
  const d1 = sign(segmentSide(b1, b2, a1));
  const d2 = sign(segmentSide(b1, b2, a2));
  const d3 = sign(segmentSide(a1, a2, b1));
  const d4 = sign(segmentSide(a1, a2, b2));
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

// Ray-segment intersection. Ray is at (ox, oy) heading (dx, dy) (dx,dy need
// not be unit — t scales accordingly). Returns the ray parameter t at the
// intersection (>=0, < maxT), or null on miss / parallel / behind / past-end.
export function raySegmentT(ox, oy, dx, dy, p1, p2, maxT) {
  const sx = p2.x - p1.x;
  const sy = p2.y - p1.y;
  const denom = dy * sx - dx * sy;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const px = ox - p1.x;
  const py = oy - p1.y;
  const t = (px * sy - py * sx) / denom;
  if (t < 0 || t > maxT) return null;
  // v parameter along the segment, picking the dominant axis for stability
  let v;
  if (Math.abs(sx) >= Math.abs(sy)) v = (px + t * dx) / sx;
  else                              v = (py + t * dy) / sy;
  if (v < 0 || v > 1) return null;
  return t;
}
