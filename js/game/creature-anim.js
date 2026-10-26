// js/game/creature-anim.js
// Animation state for skinned creatures (skin-rig.js): which baked clip plays, cross-fades between clips, gait rate
// matched to the creature's ground speed, a hit-flinch overlay and procedural head-look / jaw overrides.
// AnimState fields read by SkinnedCrowd.samplePose: a/ta (current clip, time), b/tb/w (previous clip fading out, its
// weight), c/tc/wc (overlay clip — the flinch), lookYaw/lookPitch (rad, about the neck + head), jaw (extra opening).

class AnimState {
  constructor() {
    this.a = -1; this.ta = 0; this.rate = 1;
    this.b = -1; this.tb = 0; this.rateB = 1; this.w = 0; this.fade = 0.2;
    this.c = -1; this.tc = 0; this.wc = 0;
    this.lookYaw = 0; this.lookPitch = 0; this.jaw = 0;
    this.key = null;
  }

  /** Switch to a clip (cross-fade). restart: replay a one-shot even if it's already the current clip */
  play(clip, fade = 0.2, rate = 1, restart = false) {
    if (clip < 0) return;
    if (clip === this.a && !restart) { this.rate = rate; return; }
    if (this.a >= 0 && fade > 0) { this.b = this.a; this.tb = this.ta; this.rateB = this.rate; this.w = 1; this.fade = fade; } else { this.w = 0; }
    this.a = clip; this.ta = 0; this.rate = rate;
  }

  advance(dt) {
    this.ta += dt * this.rate;
    this.tb += dt * this.rateB;
    if (this.w > 0) this.w = Math.max(0, this.w - dt / Math.max(0.01, this.fade));
    this.tc += dt;
  }
}

/** Logical clip lookup with fallbacks (GLB packs don't have every clip) */
function clipOf(model, name) {
  const ci = model.clipIndex;
  if (ci.has(name)) return ci.get(name);
  const fb = { crouch: ['idle'], pounce: ['jump', 'bite', 'run'], bite: ['attack'], roar: ['attack', 'idle'], hit: [], walk: ['run'], throw: ['bite', 'attack'], fly: ['run'], dive: ['fly', 'run'] }[name] || [];
  for (const f of fb) if (ci.has(f)) return ci.get(f);
  return -1;
}

const lerpA = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/**
 * Drives a regular enemy's animation from its gameplay state (enemies.js). Call once per rendered frame.
 * Gait: playback rate = ground speed / (clip speed × world scale), so the feet keep up with the body.
 */
function animateCreature(e, rig, time, camPos) {
  const m = rig.model;
  const an = e.anim || (e.anim = new AnimState());
  const dt = Math.min(0.1, Math.max(0, time - (e.poseT ?? time)));
  e.poseT = time;
  const ws = e.scale * m.baseScale;
  const sp = e.moveSpeed || 0;
  let clip = 'idle', rate = 1, fade = 0.2, restart = false;
  const st = e.state;
  if (st === 'dying' || st === 'launched') {
    clip = 'death'; fade = 0.08;
  } else if (e.sp.flyer) {
    clip = st === 'dive' ? 'dive' : st === 'windup' ? 'hover' : 'fly';
    if (clipOf(m, clip) < 0) clip = 'fly';
    rate = st === 'recover' || st === 'stagger' ? 1.5 : 1;
  } else if (st === 'windup') {
    clip = e.sp.charger || e.sp.swipe ? (clipOf(m, 'paw') >= 0 ? 'paw' : 'idle') : 'crouch';
    fade = 0.15;
    if (e.sp.charger && clip === 'idle') rate = 2.2;
  } else if (st === 'leap') {
    clip = 'pounce'; fade = 0.1;
  } else if (st === 'stagger') {
    clip = clipOf(m, 'hit') >= 0 ? 'hit' : 'run'; fade = 0.06; restart = an.key !== 'stagger';
  } else {
    const run = clipOf(m, 'run');
    const walkSpeed = (m.clips[clipOf(m, 'walk')]?.speed || 1) * ws;
    if (sp < 0.4) clip = 'idle';
    else if (sp < walkSpeed * 1.3 && clipOf(m, 'walk') >= 0) { clip = 'walk'; rate = Math.min(2, Math.max(0.5, sp / walkSpeed)); }
    else { clip = 'run'; const cs = (m.clips[run]?.speed || 8) * ws; rate = Math.min(2.4, Math.max(0.6, sp / cs)); }
    if (st === 'charge') rate *= 1.15;
  }
  const key = st === 'stagger' ? 'stagger' : clip;
  an.play(clipOf(m, clip), fade, rate, restart || (key !== an.key && (clip === 'death' || clip === 'pounce')));
  an.key = key;
  // Hit flinch: replay the hit overlay whenever the flinch spikes; its weight follows the flinch
  if ((e.flinch || 0) > (e.flinchPrev || 0) + 0.05 || (e.flash || 0) > (e.flashPrev || 0) + 0.25) { an.tc = 0; an.c = clipOf(m, 'hit'); }
  e.flinchPrev = e.flinch || 0; e.flashPrev = e.flash || 0;
  an.wc = an.c >= 0 && st !== 'dying' && st !== 'stagger' ? Math.min(0.85, Math.max(e.flinch || 0, (e.flash || 0) * 0.8) * 1.1) * (an.tc < 0.45 ? 1 : 0) : 0;
  // Jaw: gameplay jaw (snarl during telegraphs) on top of the clip; heads track the gunner while winding up
  an.jaw = clip === 'bite' || clip === 'roar' || clip === 'pounce' ? 0 : (e.jaw || 0) * 0.45;
  let ly = 0, lp = 0;
  if (camPos && (st === 'windup' || st === 'run') && !e.sp.flyer) {
    const dx = camPos.x - e.x, dz = camPos.z - e.z;
    ly = Math.max(-0.7, Math.min(0.7, Math.atan2(Math.sin(Math.atan2(dx, dz) - e.heading), Math.cos(Math.atan2(dx, dz) - e.heading))));
    const h = (e.hy ?? 1) - camPos.y;
    lp = Math.max(-0.35, Math.min(0.35, Math.atan2(h, Math.hypot(dx, dz)) * 0.8));
    if (st === 'run') { ly *= 0.5; lp *= 0.4; }
  }
  an.lookYaw = lerpA(an.lookYaw, ly, Math.min(1, dt * 6));
  an.lookPitch += (lp - an.lookPitch) * Math.min(1, dt * 6);
  // Fossilised: freeze the pose (the statue keeps it until it shatters)
  if ((e.stone || 0) < 1) an.advance(dt);
  return an;
}

export { AnimState, animateCreature, clipOf };
