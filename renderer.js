import { CONFIG } from './config.js';

// p5 instance and a cached vignette gradient. p5 is set externally by main.js.
let p = null;
let vignetteGfx = null;

export function attachP5(instance) {
  p = instance;
}

export function rebuildVignette(w, h) {
  if (!p) return;
  // Build the vignette into an offscreen graphic so we don't pay gradient cost per frame.
  vignetteGfx = p.createGraphics(w, h);
  const ctx = vignetteGfx.drawingContext;
  const cx = w / 2, cy = h / 2;
  const r = Math.max(w, h) * 0.75;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, `rgba(0, 0, 0, ${CONFIG.vignetteStrength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// Trail layer: instead of clearing each frame, fade with a translucent rectangle.
// This bakes motion blur/trails into the canvas itself.
export function drawTrailFade() {
  if (!p) return;
  p.noStroke();
  p.drawingContext.shadowBlur = 0;
  p.fill(CONFIG.trailFade);
  p.rect(0, 0, p.width, p.height);
}

export function drawFood(world) {
  if (!p) return;
  const ctx = p.drawingContext;
  const [r, g, b] = CONFIG.foodColor;
  const t = world.tickSec;
  ctx.shadowBlur = CONFIG.glowFood;
  ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.85)`;
  p.noStroke();
  for (const f of world.food) {
    if (f.eaten) continue;
    // Soft pulse — phase-offset per pellet so the field shimmers rather than blinks.
    const pulse = 0.7 + 0.3 * Math.sin(t * 2 + f.phase);
    p.fill(r, g, b, 200 * pulse);
    p.circle(f.x, f.y, CONFIG.foodRadius * 2);
  }
  ctx.shadowBlur = 0;
}

export function drawOrganisms(world) {
  if (!p) return;
  const ctx = p.drawingContext;
  ctx.shadowBlur = CONFIG.glowOrganism;
  p.noStroke();
  for (const o of world.organisms) {
    const lin = world.lineages.get(o.lineageId);
    const baseRgb = lin ? lin.color : [200, 200, 220];
    const [r, g, b] = baseRgb;
    // Energy modulates alpha so weak organisms visibly fade.
    const alpha = 140 + Math.min(115, (o.energy / 100) * 115);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
    p.fill(r, g, b, alpha);
    p.circle(o.x, o.y, CONFIG.organismRadius * 2);
  }
  ctx.shadowBlur = 0;
}

// Houses: translucent fill (zone tint) + soft inner border + faint outer ring
// representing the auto barrier. Drawn before organisms so they overlay it.
export function drawHouses(world) {
  if (!p || !world.houses.length) return;
  for (const h of world.houses) {
    const lin = world.lineages.get(h.lineageId);
    const [r, g, b] = lin ? lin.color : [200, 200, 220];

    p.noStroke();
    p.fill(r, g, b, 26);
    p.circle(h.x, h.y, h.radius * 2);

    p.noFill();
    p.stroke(r, g, b, 110);
    p.strokeWeight(1.2);
    p.circle(h.x, h.y, h.radius * 2);

    // Outer barrier ring — visual only in phase 3 (enforced in phase 6).
    p.stroke(r, g, b, 55);
    p.strokeWeight(0.7);
    p.circle(h.x, h.y, (h.radius + 8) * 2);
  }
  p.noStroke();
}

// Preview circle while the user drags out a new house.
export function drawHousePreview(drag) {
  if (!p || !drag) return;
  const dx = drag.currentX - drag.startX;
  const dy = drag.currentY - drag.startY;
  const r = Math.hypot(dx, dy);
  p.noFill();
  p.stroke(180, 220, 255, 160);
  p.strokeWeight(1);
  p.circle(drag.startX, drag.startY, Math.max(1, r * 2));
  p.fill(180, 220, 255, 200);
  p.noStroke();
  p.circle(drag.startX, drag.startY, 4);
}

export function drawVignette() {
  if (!p || !vignetteGfx) return;
  p.image(vignetteGfx, 0, 0);
}

// Call once on first frame to lay down the deep background under the trail layer.
export function paintBackground(rgb = CONFIG.worldBgDay) {
  if (!p) return;
  p.background(rgb[0], rgb[1], rgb[2]);
}
