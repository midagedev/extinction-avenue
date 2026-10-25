// js/game/poses.js
// Procedural animation for the rigid-part creature rigs (see rig.js): gait cycles driven by distance travelled,
// attack poses (crouch, lunge, open jaws), dive/flap for pterosaurs, and a frozen "fossil" pose when they turn to stone.
// Rotation conventions (joint frames, three.js right-handed, Euler YXZ):
//   +x on a leg/thigh swings it backward; +x on a jaw opens it; +x on a tail lifts it; +x on neck/head pitches down.
//   +z on wingL raises its tip; on wingR, -z raises it.

function set(pose, idx, name, x, y = 0, z = 0) {
  const i = idx.get(name);
  if (i === undefined) return;
  pose[i * 3] = x;
  pose[i * 3 + 1] = y;
  pose[i * 3 + 2] = z;
}

/** Writes the pose for one individual; returns an extra root lift (metres, before scale) */
function poseCreature(type, e, pose, idx, time) {
  if (e.stone >= 1) return e.frozenLift || 0; // fossilized: keep the last pose
  const moving = Math.min(1, (e.moveSpeed || 0) / Math.max(1, e.speed * 0.5));
  // Gait phase advances with distance (no foot sliding at any speed)
  // Advance by the (game) time since this individual was last posed, so the cycle is frame-rate independent
  const pdt = Math.min(0.1, Math.max(0, time - (e.poseT ?? time)));
  e.poseT = time;
  e.gait = (e.gait || 0) + (e.moveSpeed || 0) * pdt * (e.sp?.stride || 1) * 1.6 / Math.max(0.6, e.scale);
  let lift = 0;
  switch (type) {
    case 'compy':
    case 'raptor':
    case 'brute':
      lift = poseBiped(e, pose, idx, time, moving);
      break;
    case 'trike':
    case 'ankylo':
      lift = poseQuad(e, pose, idx, time, moving);
      break;
    case 'ptero':
      posePtero(e, pose, idx, time);
      break;
  }
  if (e.stone > 0) e.frozenLift = lift;
  return lift;
}

function poseBiped(e, pose, idx, time, moving) {
  const ph = e.gait;
  const s = Math.sin(ph), c = Math.cos(ph);
  const amp = 0.25 + 0.55 * moving;
  const crouch = e.state === 'windup' ? Math.min(1, e.stateT / 0.2) : 0;
  const leap = e.state === 'leap' || e.state === 'launched' ? 1 : 0;
  let lift = Math.abs(s) * 0.07 * moving - crouch * 0.22;
  // Legs (compy: single-piece legL/legR; raptors: thigh + shin)
  const legs = (side, p) => {
    const sw = Math.sin(p) * amp;
    const knee = Math.max(0, -Math.cos(p)) * 0.9 * amp;
    if (leap) {
      set(pose, idx, `thigh${side}`, -0.9, 0, 0);
      set(pose, idx, `shin${side}`, 1.1, 0, 0);
      set(pose, idx, `leg${side}`, -0.8, 0, 0);
      return;
    }
    set(pose, idx, `thigh${side}`, sw - crouch * 0.5, 0, 0);
    set(pose, idx, `shin${side}`, knee + crouch * 0.9, 0, 0);
    set(pose, idx, `leg${side}`, sw * 1.1, 0, 0);
  };
  legs('L', ph);
  legs('R', ph + Math.PI);
  // Body pitches forward when running hard and when lunging
  set(pose, idx, 'body', 0.06 * moving + crouch * 0.12 - leap * 0.1, Math.sin(ph) * 0.04 * moving, 0);
  const sway = Math.sin(ph * 0.5 + 0.4);
  set(pose, idx, 'tail1', 0.05 + 0.04 * c * moving + leap * 0.25, sway * 0.18, 0);
  set(pose, idx, 'tail2', 0.06 + 0.05 * c * moving + leap * 0.2, sway * 0.26, 0);
  set(pose, idx, 'neck', -0.05 + Math.sin(ph * 2) * 0.05 * moving - crouch * 0.15, 0, 0);
  set(pose, idx, 'head', Math.sin(ph * 2 + 1) * 0.06 * moving + crouch * 0.25, Math.sin(time * 1.3 + e.offA) * 0.15 * (1 - moving), 0);
  set(pose, idx, 'jaw', 0.08 + e.jaw * 0.75 + (e.stone > 0 ? 0.5 : 0), 0, 0);
  set(pose, idx, 'armL', 0.4 + Math.sin(ph + 1) * 0.25 * moving - leap * 0.6, 0, 0);
  set(pose, idx, 'armR', 0.4 + Math.sin(ph + 1 + Math.PI) * 0.25 * moving - leap * 0.6, 0, 0);
  return lift;
}

function poseQuad(e, pose, idx, time, moving) {
  const ph = e.gait;
  const charging = e.state === 'charge' ? 1 : 0;
  const amp = (0.18 + 0.28 * moving) * (1 + charging * 0.5);
  const s = Math.sin(ph);
  // Trot: diagonal pairs in phase
  set(pose, idx, 'legFL', s * amp, 0, 0);
  set(pose, idx, 'legBR', s * amp, 0, 0);
  set(pose, idx, 'legFR', -s * amp, 0, 0);
  set(pose, idx, 'legBL', -s * amp, 0, 0);
  const wind = e.state === 'windup' ? 1 : 0;
  // Windup: head down, pawing; charge: head low and level
  const headDown = wind * (0.25 + Math.sin(time * 14) * 0.05) + charging * 0.3;
  set(pose, idx, 'body', 0.02 * Math.sin(ph * 2) * moving + wind * 0.04, Math.sin(ph) * 0.03 * moving, Math.sin(ph) * 0.025 * moving);
  set(pose, idx, 'head', headDown + Math.sin(ph * 2) * 0.04 * moving + Math.sin(time * 0.9 + e.offA) * 0.06 * (1 - moving), Math.sin(time * 0.7 + e.offA) * 0.2 * (1 - moving) * (1 - wind), 0);
  const sway = Math.sin(ph * 0.5);
  const swipe = e.type === 'ankylo' && e.state === 'windup' ? Math.sin(e.stateT * 18) * 0.8 : 0;
  set(pose, idx, 'tail', 0.05, sway * 0.15, 0);
  set(pose, idx, 'tail1', 0.05, sway * 0.15 + swipe * 0.5, 0);
  set(pose, idx, 'tail2', 0.02, sway * 0.25 + swipe, 0);
  return Math.abs(Math.sin(ph * 2)) * 0.05 * moving;
}

function posePtero(e, pose, idx, time) {
  const diving = e.state === 'windup' ? 1 : 0;
  const climbing = e.state === 'recover' ? 1 : 0;
  const rate = climbing ? 9 : 4.2;
  const f = Math.sin(time * rate + e.offA);
  const flap = diving ? 0 : f * (climbing ? 0.7 : 0.45);
  const fold = diving ? 0.9 : 0;
  set(pose, idx, 'wingL', 0, fold * 0.9, flap + fold * 0.25);
  set(pose, idx, 'wingR', 0, -fold * 0.9, -flap - fold * 0.25);
  set(pose, idx, 'wingTipL', 0, fold * 0.5, flap * 0.6 + fold * 0.3);
  set(pose, idx, 'wingTipR', 0, -fold * 0.5, -flap * 0.6 - fold * 0.3);
  set(pose, idx, 'neck', -0.1 + diving * 0.2, 0, 0);
  set(pose, idx, 'head', Math.sin(time * 2 + e.offA) * 0.1, Math.sin(time * 1.1 + e.offA) * 0.2, 0);
  set(pose, idx, 'jaw', 0.05 + e.jaw * 0.6, 0, 0);
  set(pose, idx, 'body', 0, 0, 0);
}

export { poseCreature, set as setJoint };
