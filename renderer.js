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

// Trail layer: instead of clearing each frame, fade with a translucent
// rectangle. The colour is the current sky tint, so the canvas slowly
// drifts toward day or night while still leaving organism trails behind.
// Alpha is constant (~0.15) — that controls how fast trails decay.
export function drawTrailFade(rgb = CONFIG.worldBgDay) {
  if (!p) return;
  p.noStroke();
  p.drawingContext.shadowBlur = 0;
  p.fill(rgb[0], rgb[1], rgb[2], 38);
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

// Non-house zones: subtle filled disc with a dashed outline so it visually
// reads as "a rule region without a fortified wall". Drawn before houses so
// houses overlay them if they overlap.
export function drawZones(world) {
  if (!p || !world.zones.length) return;
  const ctx = p.drawingContext;
  for (const z of world.zones) {
    const [r, g, b] = z.color;
    p.noStroke();
    p.fill(r, g, b, 16);
    p.circle(z.x, z.y, z.radius * 2);

    p.noFill();
    p.stroke(r, g, b, 90);
    p.strokeWeight(0.9);
    ctx.setLineDash([5, 4]);
    p.circle(z.x, z.y, z.radius * 2);
  }
  ctx.setLineDash([]);
  p.noStroke();
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

// Predators — bigger, saturated red, strong glow, tiny heading tick so the
// user can see what they're chasing. Drawn over organisms.
export function drawPredators(world) {
  if (!p || !world.predators.length) return;
  const ctx = p.drawingContext;
  ctx.shadowBlur = 14;
  p.noStroke();
  for (const pr of world.predators) {
    if (!pr.alive) continue;
    const energyAlpha = 200 + Math.min(55, (pr.energy / CONFIG.predatorMaxEnergy) * 55);
    ctx.shadowColor = 'rgba(255, 90, 100, 0.95)';
    p.fill(255, 90, 100, energyAlpha);
    p.circle(pr.x, pr.y, CONFIG.predatorRadius * 2);
  }
  ctx.shadowBlur = 0;
  // Heading tick — a faint forward stroke per predator. Done in a second
  // pass without shadow so it stays crisp.
  p.stroke(255, 210, 210, 200);
  p.strokeWeight(1);
  for (const pr of world.predators) {
    if (!pr.alive) continue;
    const dx = Math.cos(pr.heading) * (CONFIG.predatorRadius + 2);
    const dy = Math.sin(pr.heading) * (CONFIG.predatorRadius + 2);
    p.line(pr.x, pr.y, pr.x + dx, pr.y + dy);
  }
  p.noStroke();
}

// Drawn barriers — thick line per segment. Stroke alpha is dimmed when the
// barrier is transparent on either side, hinting at the see-through nature.
export function drawBarriers(world) {
  if (!p || !world.barriers.length) return;
  for (const b of world.barriers) {
    const [r, g, gb] = b.color;
    const transparency = (b.transparentFromSideA ? 1 : 0) + (b.transparentFromSideB ? 1 : 0);
    const alpha = 220 - transparency * 60;  // both transparent → 100, one → 160, none → 220
    p.stroke(r, g, gb, alpha);
    p.strokeWeight(b.thickness);
    p.strokeCap?.(p.ROUND);
    for (let i = 0; i < b.points.length - 1; i++) {
      const a = b.points[i], c = b.points[i + 1];
      p.line(a.x, a.y, c.x, c.y);
    }
  }
  p.noStroke();
}

// Generic placement preview: dispatches on tool kind so house/zone/barrier
// each get their own ghost. drag.tool is set by tools.js on mousedown.
export function drawPlacementPreview(drag) {
  if (!p || !drag) return;
  if (drag.tool === 'house' || drag.tool === 'zone') {
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
  } else if (drag.tool === 'barrier') {
    p.stroke(220, 200, 130, 220);
    p.strokeWeight(3);
    p.line(drag.startX, drag.startY, drag.currentX, drag.currentY);
    p.noStroke();
    p.fill(220, 200, 130, 220);
    p.circle(drag.startX, drag.startY, 5);
    p.circle(drag.currentX, drag.currentY, 5);
  }
}

export function drawVignette() {
  if (!p || !vignetteGfx) return;
  p.image(vignetteGfx, 0, 0);
}

// Per-frame dim layer driven by daylight (0..1). Drawn AFTER the entities
// and the vignette so it darkens everything uniformly — including the
// organism glows — for an unmistakable "it is night" feel.
export function drawNightTint(daylight) {
  if (!p) return;
  const night = 1 - daylight;
  if (night <= 0.02) return;
  // Quadratic ramp so dusk/dawn are gentle but midnight is heavy.
  const k = night * night;
  const alpha = Math.min(255, k * CONFIG.nightDimAlpha * 255);
  p.noStroke();
  p.drawingContext.shadowBlur = 0;
  // Slight blue tint so the night reads as "deep night" rather than dead grey.
  p.fill(2, 4, 14, alpha);
  p.rect(0, 0, p.width, p.height);
}

// Call once on first frame to lay down the deep background under the trail layer.
export function paintBackground(rgb = CONFIG.worldBgDay) {
  if (!p) return;
  p.background(rgb[0], rgb[1], rgb[2]);
}
