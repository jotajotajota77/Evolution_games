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
  p.fill(rgb[0], rgb[1], rgb[2], CONFIG.trailFadeAlpha);
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
  p.noStroke();
  for (const o of world.organisms) {
    const lin = world.lineages.get(o.lineageId);
    const base = lin ? lin.color : [200, 200, 220];
    // Per-individual drift accumulates across generations — paints a soft
    // family tree onto the lineage's base hue.
    const d = o.colorDrift;
    const r = clampByte(base[0] + (d ? d[0] : 0));
    const g = clampByte(base[1] + (d ? d[1] : 0));
    const b = clampByte(base[2] + (d ? d[2] : 0));
    // Energy modulates alpha so weak organisms visibly fade.
    const alpha = 140 + Math.min(115, (o.energy / 100) * 115);
    // Firefly breath: the glow halo waxes and wanes on the organism's own
    // pulse phase. The dot itself is untouched so the position stays crisp.
    const pulse = 0.55 + 0.45 * Math.sin(o.pulsePhase || 0);
    ctx.shadowBlur = CONFIG.glowOrganism * pulse;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.9 * pulse})`;
    p.fill(r, g, b, alpha);
    p.circle(o.x, o.y, CONFIG.organismRadius * 2);
  }
  ctx.shadowBlur = 0;
}

function clampByte(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

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

// Pulsing white ring drawn over a specific organism. Used by the
// "follow best" toggle to mark the oldest alive organism without
// dragging the camera around.
export function drawOrganismHighlight(org) {
  if (!p || !org || !org.alive) return;
  const ctx = p.drawingContext;
  const baseR = CONFIG.organismRadius * 2 + 6;
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.0035);
  ctx.shadowBlur = 18 * pulse;
  ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
  p.noFill();
  p.stroke(255, 255, 255, 160 + 80 * pulse);
  p.strokeWeight(1.6);
  p.circle(org.x, org.y, baseR * 2);
  // Inner accent dot — keeps the marker visible even when the outer ring
  // pulses faint.
  p.fill(255, 255, 255, 220);
  p.noStroke();
  p.circle(org.x, org.y, 2.4);
  ctx.shadowBlur = 0;
}

// Cached soft-radial sprite used to paint poison puffs. Drawing the same
// blurred-edge bitmap at each puff position (with per-puff scale + alpha)
// gives a smoke-trail look without any visible hard circle. Built lazily
// the first time a puff renders.
let poisonSprite = null;

function buildPoisonSprite() {
  const SZ = 128;
  const cnv = document.createElement('canvas');
  cnv.width = SZ; cnv.height = SZ;
  const c = cnv.getContext('2d');
  const [r, g, b] = CONFIG.poisonColor;
  const grad = c.createRadialGradient(SZ / 2, SZ / 2, 0, SZ / 2, SZ / 2, SZ / 2);
  // Soft falloff: dense core, long fade to transparent edge — overlapping
  // sprites blend into a continuous smoke wisp.
  grad.addColorStop(0,    `rgba(${r}, ${g}, ${b}, 0.9)`);
  grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.5)`);
  grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.18)`);
  grad.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, SZ, SZ);
  return cnv;
}

// Drawn under organisms so they sit on top. Each puff is a scaled bitmap
// blit with per-puff alpha — no hard circle edge, no shadowBlur cost.
export function drawPoisons(world) {
  if (!p || !world.poisons.length) return;
  if (!poisonSprite) poisonSprite = buildPoisonSprite();
  const ctx = p.drawingContext;
  const baseR = CONFIG.poisonRadius;
  for (const pn of world.poisons) {
    const life = pn.ageSec / CONFIG.poisonDurationSec; // 0..1
    const intensity = pn.intensity ?? 1;
    // Alpha fades with age, scales with intensity. The sprite already has
    // its own falloff baked in; this multiplies on top.
    const alpha = (1 - life) * 0.6 * (0.45 + 0.55 * intensity);
    // Half-extent of the drawn sprite in world pixels. Slightly bigger as
    // it ages so the puff visually disperses, and bigger again with intent.
    const half = baseR * 2.4 * (0.55 + 0.45 * intensity) * (0.8 + life * 0.5);
    ctx.globalAlpha = alpha;
    ctx.drawImage(poisonSprite, pn.x - half, pn.y - half, half * 2, half * 2);
  }
  ctx.globalAlpha = 1;
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
    // Predator energy has no upper bound, so we just floor the alpha at a
    // visible level and clamp the upper end.
    const energyAlpha = 200 + Math.min(55, Math.max(0, pr.energy) / 100 * 55);
    if (pr.poisonedRemainingSec > 0) {
      // Vivid lime-yellow tint while poisoned — instantly readable signal
      // that the predator is slowed.
      const [pr1, pg1, pb1] = CONFIG.predatorPoisonedColor;
      ctx.shadowColor = `rgba(${pr1}, ${pg1}, ${pb1}, 0.9)`;
      p.fill(pr1, pg1, pb1, energyAlpha);
    } else {
      ctx.shadowColor = 'rgba(255, 90, 100, 0.95)';
      p.fill(255, 90, 100, energyAlpha);
    }
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
