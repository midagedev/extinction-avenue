// js/game/icons.js
// EXTINCTION AVENUE — original icon set.
// Style: 48 × 48 grid, solid duotone. Every icon is drawn in `currentColor` with three tones:
//   P = primary (solid), S = secondary (same hue, translucent; "back" parts), K = shade (black overlay for detail on P).
// No ids/defs/clipPaths are used, so any number of copies can live inline in one document.
//
//   iconSVG(id, { size, cls, title }) → SVG markup string (static, safe for innerHTML)
//   iconEl(id, opts)                  → SVGElement
//   ICON_IDS                          → list of every available id

const P = 'fill="currentColor"';
const S = 'fill="currentColor" fill-opacity=".42"';
const K = 'fill="#000" fill-opacity=".38"';
const L = (w = 3) => `fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const KL = (w = 3) => `fill="none" stroke="#000" stroke-opacity=".42" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const SL = (w = 3) => `fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

const f = (n) => Math.round(n * 100) / 100;
const pt = (cx, cy, r, a) => `${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;

function starPath(cx, cy, rO, rI, n, rot = -Math.PI / 2) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    d += (i ? 'L' : 'M') + pt(cx, cy, i % 2 ? rI : rO, a);
  }
  return d + 'Z';
}

function circlePath(cx, cy, r, ccw = false) {
  const s = ccw ? 0 : 1;
  return `M${f(cx - r)} ${cy}a${r} ${r} 0 1 ${s} ${r * 2} 0a${r} ${r} 0 1 ${s} ${-r * 2} 0Z`;
}

function sawPath(cx, cy, rO, rI, n, rot = 0) {
  const s = (Math.PI * 2) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = rot + i * s;
    d += (i ? 'L' : 'M') + pt(cx, cy, rI, a);
    d += 'L' + pt(cx, cy, rO, a + s * 0.3);
    d += 'L' + pt(cx, cy, rO - (rO - rI) * 0.35, a + s * 0.62);
  }
  return d + 'Z';
}

function gearPath(cx, cy, rO, rI, n) {
  const s = (Math.PI * 2) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i * s - Math.PI / 2;
    d += (i ? 'L' : 'M') + pt(cx, cy, rI, a - s * 0.5);
    d += 'L' + pt(cx, cy, rI, a - s * 0.28);
    d += 'L' + pt(cx, cy, rO, a - s * 0.18);
    d += 'L' + pt(cx, cy, rO, a + s * 0.18);
    d += 'L' + pt(cx, cy, rI, a + s * 0.28);
  }
  return d + 'Z';
}

// rocket pointing +x, origin at the nozzle, ~19 long
const rocket = (x, y, rot, sc = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})">
  <path ${S} d="M-1 -2.4L-9 0L-1 2.4Z"/>
  <path ${P} d="M0 -3.4H11Q17.5 -3.4 19.5 0Q17.5 3.4 11 3.4H0Z"/>
  <path ${P} d="M0.5 -3L-2.5 -7.5H3L5 -3ZM0.5 3L-2.5 7.5H3L5 3Z"/>
  <path ${K} d="M11 -3.4h2.2v6.8H11Z"/></g>`;

const bolt = (x, y, sc = 1, attrs = P) => `<path ${attrs} transform="translate(${x} ${y}) scale(${sc})" d="M7 0L0 11H5.5L2.5 20L12 7.5H6.5L10 0Z"/>`;

const gatlingBody = `
  <rect ${S} x="3" y="12" width="15" height="24" rx="3"/>
  <rect ${P} x="13" y="14.5" width="27" height="5" rx="2.2"/>
  <rect ${P} x="13" y="21.5" width="30" height="5" rx="2.2"/>
  <rect ${P} x="13" y="28.5" width="27" height="5" rx="2.2"/>
  <rect ${P} x="29" y="11.5" width="4.5" height="25" rx="1.5"/>
  <rect ${K} x="29" y="11.5" width="1.5" height="25"/>
  <rect ${P} x="6" y="36" width="8" height="6" rx="1.2"/>`;

const mineBody = (y = 0) => `<g transform="translate(0 ${y})">
  <path ${P} d="M8 31c0-4.6 7.2-8.4 16-8.4s16 3.8 16 8.4v3.6c0 3.6-7.2 6.6-16 6.6S8 38.2 8 34.6Z"/>
  <ellipse ${K} cx="24" cy="31.2" rx="11.5" ry="3.8"/>
  <path ${K} d="M8 33.4c2 3 8.4 5 16 5s14-2 16-5v1.2c0 3.6-7.2 6.6-16 6.6S8 38.2 8 34.6Z"/>
  <rect ${P} x="21" y="20" width="6" height="9" rx="1.6"/>
  <circle ${P} cx="24" cy="17" r="4.6"/></g>`;

// ---------------------------------------------------------------------------------------------------------------
const ICONS = {
  // ---------------------------------------------------------------- weapons
  cannon: `
    <path ${S} d="M5 43h38v-4.5a5 5 0 0 0-5-5H10a5 5 0 0 0-5 5Z"/>
    <g transform="rotate(-38 24 30)"><rect ${P} x="23" y="26.2" width="18" height="7.6" rx="1.6"/><rect ${P} x="38.5" y="24" width="6.5" height="12" rx="1.6"/><rect ${K} x="38.5" y="28.6" width="6.5" height="2.8"/></g>
    <path ${P} d="M12 33.5a12 12 0 0 1 24 0Z"/>
    <path ${K} d="M24 21.5a12 12 0 0 1 12 12h-12Z"/>
    <path ${P} d="${starPath(43, 7, 5, 1.8, 4)}"/>`,
  gatling: `${gatlingBody}
    <path ${L(2.6)} d="M44.5 13.5l2-1.5M45.5 24h2M44.5 34.5l2 1.5"/>`,
  saws: `
    <path ${P} fill-rule="evenodd" d="${sawPath(24, 24, 21.5, 15.5, 12)}${circlePath(24, 24, 7.5)}"/>
    <circle ${S} cx="24" cy="24" r="7.5"/>
    <circle ${P} cx="24" cy="24" r="3"/>
    <circle ${K} cx="24" cy="12.5" r="2"/><circle ${K} cx="34" cy="29.8" r="2"/><circle ${K} cx="14" cy="29.8" r="2"/>`,
  missiles: `${rocket(9, 41, -42, 1)}${rocket(22, 33, -42, 1)}${rocket(9, 23, -42, 0.78)}`,
  tesla: `
    <path ${S} d="M12 45h24l-3.5-6.5h-17Z"/>
    <rect ${P} x="19.5" y="20" width="9" height="19" rx="1"/>
    <rect ${P} x="15.5" y="22" width="17" height="3.2" rx="1.6"/>
    <rect ${P} x="15.5" y="27.6" width="17" height="3.2" rx="1.6"/>
    <rect ${P} x="15.5" y="33.2" width="17" height="3.2" rx="1.6"/>
    <ellipse ${P} cx="24" cy="14" rx="10" ry="6.5"/>
    <ellipse ${K} cx="24" cy="15.6" rx="10" ry="2.6"/>
    <path ${L(2.6)} d="M34.5 12.5l4.5-3.5-.5 5 5.5-4M13.5 12.5L9 9l.5 5L4 10"/>
    <path ${SL(2.4)} d="M36 20l5 1.5M12 20l-5 1.5"/>`,
  flamer: `
    <rect ${S} x="2" y="19" width="10" height="11" rx="1.5"/>
    <rect ${P} x="9" y="16.5" width="7" height="16" rx="2"/>
    <path ${P} d="M16 24.5c5-9 13-13 22-11-3 1.8-4 4-3.4 6 4-2 8.6-1.4 11.4 1.6-4 1-6 2.8-6 5 3-.2 5 .8 6 2.8-6 3.4-14 4.6-21 2.6-4-1-7.4-3.8-9-7Z"/>
    <path ${K} d="M18 25c5-3.8 10-5 15-4-2 2-2 4.2.4 6-5.4 1.2-10.6.4-15.4-2Z"/>`,
  mines: `${mineBody(0)}
    <path ${L(2.6)} d="M24 3.5v4.5M13.5 8l3 3M34.5 8l-3 3M9 16.5h4.5M34.5 16.5H39"/>`,
  shotgun: `
    <rect ${P} x="3" y="9" width="8" height="30" rx="3"/>
    <rect ${S} x="10" y="15" width="5" height="18" rx="1"/>
    <rect ${K} x="3" y="22.5" width="8" height="3"/>
    <circle ${P} cx="22" cy="24" r="3.4"/>
    <circle ${P} cx="30" cy="15.5" r="3"/><circle ${P} cx="30" cy="32.5" r="3"/><circle ${P} cx="33" cy="24" r="2.8"/>
    <circle ${P} cx="39.5" cy="8.5" r="2.6"/><circle ${P} cx="43" cy="19" r="2.5"/><circle ${P} cx="43" cy="29" r="2.5"/><circle ${P} cx="39.5" cy="39.5" r="2.6"/>
    <path ${SL(2.2)} d="M16 18.5l4-2M16 29.5l4 2"/>`,

  // ---------------------------------------------------------------- evolutions
  railgun: `
    <path ${P} d="M3 11h33l7 5H3Z"/>
    <path ${P} d="M3 37h33l7-5H3Z"/>
    <rect ${S} x="6" y="19.5" width="40" height="9" rx="4.5"/>
    <rect ${P} x="6" y="22.2" width="41" height="3.6" rx="1.8"/>
    <rect ${K} x="9" y="11" width="3" height="5"/><rect ${K} x="17" y="11" width="3" height="5"/><rect ${K} x="25" y="11" width="3" height="5"/>
    <rect ${K} x="9" y="32" width="3" height="5"/><rect ${K} x="17" y="32" width="3" height="5"/><rect ${K} x="25" y="32" width="3" height="5"/>
    <path ${P} d="${starPath(44, 24, 4.5, 1.6, 4)}"/>`,
  storm_gatling: `<g transform="translate(-1 8) scale(.84)">${gatlingBody}</g>
    ${bolt(30, 1, 1.2)}`,
  buzzsaw: `
    <circle ${SL(2.6)} stroke-dasharray="4 4" cx="24" cy="24" r="15"/>
    <circle ${P} cx="24" cy="24" r="6"/><circle ${K} cx="24" cy="24" r="2.4"/>
    <path ${P} fill-rule="evenodd" d="${sawPath(24, 9, 8.5, 5.8, 8)}${circlePath(24, 9, 2)}"/>
    <path ${P} fill-rule="evenodd" d="${sawPath(37, 31.5, 8.5, 5.8, 8, 0.4)}${circlePath(37, 31.5, 2)}"/>
    <path ${P} fill-rule="evenodd" d="${sawPath(11, 31.5, 8.5, 5.8, 8, 0.8)}${circlePath(11, 31.5, 2)}"/>`,
  cluster: `${rocket(8, 41, -45, 1.15)}
    ${rocket(30, 19, -80, 0.55)}${rocket(31, 18, -45, 0.55)}${rocket(32, 18, -10, 0.55)}
    <circle ${S} cx="28" cy="20" r="4"/>`,
  thunder: `
    <path ${P} d="M5 36L7 12l9.5 10L24 6l7.5 16L41 12l2 24Z"/>
    <circle ${P} cx="7" cy="10.5" r="3"/><circle ${P} cx="24" cy="5" r="3"/><circle ${P} cx="41" cy="10.5" r="3"/>
    <rect ${S} x="5" y="38" width="38" height="5" rx="2"/>
    ${bolt(18.5, 15, 1, K)}`,
  inferno: `
    <rect ${S} x="3" y="36" width="13" height="7" rx="1.5"/>
    <path ${P} d="M9 41C6 29 13 23 17 14c2.4 6 6 8 8.4 2.4 3.6 6 6-4 4-12.4 10 8 15.6 20 11.6 30-3 7-11.6 10-19.6 10-6 0-10.8-1-12.4-3Z"/>
    <path ${K} d="M16.5 41c-2-6.4 2-10.4 5.2-13.6 1 4 3.2 5 5.4 3 2.4 4.2 3.2 7.6 1 10.8-3.6 2-8.4 2-11.6-.2Z"/>
    <path ${S} d="M33 6c4 2 8 6 9 10-2-1-4-1-5 0 0-4-2-7-4-10Z"/>`,
  nova: `
    <path ${S} d="${starPath(24, 24, 23, 13, 12)}"/>
    <g transform="translate(0 2)">${mineBody(0)}</g>`,
  dragon: `
    <rect ${S} x="3" y="16" width="6" height="16" rx="1.2"/>
    <rect ${P} x="8" y="15" width="15" height="18" rx="2.4"/>
    <rect ${K} x="12" y="15" width="2.5" height="18"/>
    <path ${P} d="M23 19C31 13 37 7 46 6.5c-4.6 5.8-3.6 9.4 0 12.5-4 1.6-4.6 4-.4 5.4-4 2-4.8 5-.2 9.6-8.4.6-15.4-4.4-22.4-10Z"/>
    <path ${K} d="M24 21.5c6-1.8 11-3.2 16-2.4-2.2 2-2.4 4 .4 5.8-6 1-11 .2-16.4-1.4Z"/>`,

  // ---------------------------------------------------------------- passives
  armor: `
    <path ${P} d="M24 3.5L41 10v13.5c0 10.4-7 17.2-17 21-10-3.8-17-10.6-17-21V10Z"/>
    <path ${K} d="M24 3.5L41 10v13.5c0 10.4-7 17.2-17 21Z"/>
    <path ${KL(2.6)} d="M7.5 22.5h33"/>
    <circle ${K} cx="13" cy="14" r="1.8"/><circle ${K} cx="13" cy="30" r="1.8"/>`,
  chassis: `
    <rect ${S} x="4" y="6" width="8" height="12" rx="2.4"/><rect ${S} x="36" y="6" width="8" height="12" rx="2.4"/>
    <rect ${S} x="4" y="30" width="8" height="12" rx="2.4"/><rect ${S} x="36" y="30" width="8" height="12" rx="2.4"/>
    <rect ${P} x="14" y="3" width="6" height="42" rx="2"/><rect ${P} x="28" y="3" width="6" height="42" rx="2"/>
    <rect ${P} x="12" y="10" width="24" height="5" rx="1.5"/><rect ${P} x="12" y="21.5" width="24" height="5" rx="1.5"/><rect ${P} x="12" y="33" width="24" height="5" rx="1.5"/>
    <path ${KL(2)} d="M20 15l8 6.5M28 15l-8 6.5M20 26.5l8 6.5M28 26.5l-8 6.5"/>`,
  turbo: `
    <path ${P} d="M22 7H42a2 2 0 0 1 2 2v9H30Z"/>
    <path ${P} fill-rule="evenodd" d="${circlePath(22, 26, 18)}${circlePath(22, 26, 8.5, true)}"/>
    <circle ${S} cx="22" cy="26" r="8.5"/>
    <path ${P} d="${starPath(22, 26, 7.4, 2.6, 5, 0.3)}"/>
    <path ${KL(2.4)} d="M22 12.5a13.5 13.5 0 0 1 13.5 13.5"/>`,
  magnet: `
    <path fill="none" stroke="currentColor" stroke-width="9" d="M12.5 15v11a11.5 11.5 0 0 0 23 0V15"/>
    <rect ${S} x="8" y="7" width="9" height="8" rx="1"/><rect ${S} x="31" y="7" width="9" height="8" rx="1"/>
    <path ${KL(2.4)} d="M12.5 30a11.5 11.5 0 0 0 23 0" stroke-opacity=".3"/>
    <path ${P} d="M24 2l4 5.5-4 5.5-4-5.5Z"/>`,
  ram: `
    <path ${P} d="M4 6h13l27 18-27 18H4l10-18Z"/>
    <path ${K} d="M14 24L4 42h13l27-18Z"/>
    <path ${KL(2.4)} d="M17 6l-4 18 4 18" stroke-opacity=".3"/>
    <circle ${S} cx="8" cy="24" r="2.5"/>`,
  loader: `
    <rect ${S} x="3" y="38" width="42" height="6" rx="2"/>
    <path ${P} d="M7 20c0-6 2.4-10 4.5-12.5C13.6 10 16 14 16 20v16H7Z"/>
    <path ${P} d="M19.5 20c0-6 2.4-10 4.5-12.5C26.1 10 28.5 14 28.5 20v16h-9Z"/>
    <path ${P} d="M32 20c0-6 2.4-10 4.5-12.5C38.6 10 41 14 41 20v16h-9Z"/>
    <rect ${K} x="7" y="25" width="9" height="2.6"/><rect ${K} x="19.5" y="25" width="9" height="2.6"/><rect ${K} x="32" y="25" width="9" height="2.6"/>`,
  hollow: `
    <path ${P} d="M3 15.5h22c8 0 14 3 19 8.5-5 5.5-11 8.5-19 8.5H3Z"/>
    <rect ${K} x="17" y="15.5" width="3" height="17"/>
    <path ${K} d="M44 24l-8-3.6v7.2Z"/>
    <path ${SL(2.6)} d="M39 10l3-4M41 14l5-2M39 38l3 4M41 34l5 2"/>`,
  boom: `
    <path ${S} d="${starPath(24, 24, 23, 15, 11)}"/>
    <path ${P} d="${starPath(24, 24, 18, 9.5, 9, -1.2)}"/>
    <path ${K} d="${starPath(24, 24, 8.5, 4, 6, -0.4)}"/>`,

  // ---------------------------------------------------------------- pickups
  repair: `
    <path ${P} d="M31 3.5a10 10 0 0 0-9.4 13.4L4.6 33.9a4.4 4.4 0 0 0 6.2 6.2L27.8 23a10 10 0 0 0 13.4-9.4l-6 6-6.4-1.8-1.8-6.4Z"/>
    <circle ${K} cx="7.8" cy="36.9" r="1.8"/>
    <path ${S} d="M35 28h4.4v6.6H46V39h-6.6v6.6H35V39h-6.6v-4.4H35Z"/>`,
  nitro: `
    <rect ${S} x="15" y="2" width="18" height="5" rx="1.5"/>
    <rect ${P} x="19.5" y="6" width="9" height="7" rx="1"/>
    <rect ${P} x="13" y="12" width="22" height="33" rx="7"/>
    <rect ${K} x="13" y="21" width="22" height="13"/>
    ${bolt(18, 18, 0.62, P)}`,
  vacuum: `
    <path ${L(3.6)} d="M24 24m0-3a3 3 0 1 1-3 3 6.5 6.5 0 0 1 6.5-6.5A10 10 0 0 1 37.5 27.5 13.5 13.5 0 0 1 24 41 17 17 0 0 1 7 24 20 20 0 0 1 27 4"/>
    <circle ${S} cx="40" cy="9" r="2.8"/><circle ${S} cx="43" cy="18" r="2.2"/><circle ${S} cx="34" cy="4" r="1.8"/>`,
  crate: `
    <rect ${P} x="5" y="12" width="38" height="31" rx="2.5"/>
    <rect ${S} x="3" y="6" width="42" height="9" rx="2"/>
    <path ${KL(3)} d="M10 17l28 21M38 17L10 38"/>
    <rect ${K} x="5" y="12" width="38" height="3"/>
    <rect ${KL(2.4)} x="8.5" y="15.5" width="31" height="24" rx="1"/>`,
  airstrike: `
    <ellipse ${SL(2.6)} cx="24" cy="41" rx="17" ry="4.6"/>
    <path ${P} d="M18 11a6 6 0 0 1 12 0v15l-6 9.5-6-9.5Z"/>
    <path ${P} d="M18 7.5l-5.5-5V13l5.5 3ZM30 7.5l5.5-5V13L30 16Z"/>
    <rect ${K} x="18" y="18" width="12" height="3.2"/>
    <path ${SL(2.4)} d="M9 20v8M39 20v8M5 26v5M43 26v5"/>`,
  gem: `
    <path ${P} d="M24 3l14 9v24L24 45 10 36V12Z"/>
    <path ${K} d="M24 3l14 9v24L24 45Z"/>
    <path ${KL(2)} d="M10 12l14 8 14-8M24 20v25" stroke-opacity=".3"/>
    <path ${P} d="${starPath(41, 5, 4.5, 1.4, 4)}"/>`,
  score: `
    <circle ${P} cx="24" cy="24" r="20"/>
    <circle ${KL(2.4)} cx="24" cy="24" r="15.5" stroke-opacity=".3"/>
    <path ${K} d="${starPath(24, 25, 11, 4.6, 5)}"/>`,

  // ---------------------------------------------------------------- creatures (side silhouettes, facing right)
  compy: `
    <path ${S} d="M21 30l-2 6 1.5 6h-4l1-6 1-7Z"/>
    <path ${P} fill-rule="evenodd" d="M2 23c8 2 14 2 20 1.2 3-.4 5-1 6.4-3L31 14.5c.8-2 2.2-3.2 4.2-3.4l4.3-.4c1.5 0 2.6.7 3.7 1.6l1.6 1.4-6 1.4-2.3.3-2.5 1.5-2.4 7.3c-.6 1.7-1.7 3-1.3 4l3.2 2.3-.8.9-3.6-1.7-1.6 1.4L30 32l-3 6 4 3.6-1.3.8-6-3.2 2.4-8.2-4.4-1.6C13 30.6 7 27.4 2 23Z${circlePath(37.2, 12.7, 0.9, true)}"/>`,
  raptor: `
    <path ${S} d="M20 25l-1.5 6 4 5.5-1 5.5h-4l1.3-5-4.4-6 1.4-7Z"/>
    <path ${P} fill-rule="evenodd" d="M1 17.5c9 .4 16 .3 23-.6 3-.4 5.3-.8 7-2.2l3.3-3.3c1.2-1.2 2.8-1.9 4.5-1.9h3.6c1.4 0 2.6.6 3.5 1.6L47 13l-7 1.3-2.4.3-2.2 1.6c-.8 1.4-1.4 3-1.2 4.4l4.2 2.6 1.4 3.2-1.2.4-2.4-2.5-4-.9c-1.2 1.6-2.6 2.5-3.6 3l2.2 5.6-4.4 5.2 4.5 3.5-1 .9-3-1.2-3.7.8-.6-1.5 1.2-1.2-2 .2-.4-1 4.2-6-3.6-4.6C14 24.4 7 21.6 1 17.5Z${circlePath(39.8, 12.6, 1, true)}"/>`,
  brute: `
    <path ${S} d="M17 28l-3 7 1 7h-5l.5-7 2-9Z"/>
    <path ${P} fill-rule="evenodd" d="M1 21c6-4 12-7.6 19-9.2 4.4-1 9-.8 12.6.6l1.8-4.2 1.8 4.4 3 .6 1.2-3.4 1.4 4c2.8.8 4.8 2.4 5.8 4.6l.4 3.4-4.2.4-4 1.4 3.4 1.2-.6 1.6-4.6-.4-2.8 1.2-.6 4.4 3 1.6-.8 1.6-3.8-.8-1.6 2.6 1.6 7.6 3.2 1.6v1h-9.6l-.8-8.4-6-3C11 28 5.6 25 1 21Z${circlePath(38, 14.6, 1.1, true)}"/>`,
  trike: `
    <path ${S} d="M10 31l-2 11h4.5l2-9ZM29 33l-1 9h4.5l1-8Z"/>
    <path ${S} d="M27 25c-2-8 1-15 6.4-18 3.4-1.8 6.4.2 6.6 4 .2 4.8-1.4 9.6-4.4 14.4Z"/>
    <path ${P} fill-rule="evenodd" d="M2 27.6c4-5.4 10-9.4 18-10.2 6.4-.6 11 .8 14.6 3.4l3.4-3c1.6-1.4 4-1.2 5.4.2l2.6 4.4.6 4.8-1.6 2.6-3.8.4-2 2.6-3.4.4-1 2.4.6 7.4h-5l-.4-6c-5 1.6-11 1.6-16 .2l-.6 5.8H9l.4-7.6C6.4 31.6 4 29.8 2 27.6Z${circlePath(40.2, 21.2, 1, true)}"/>
    <path ${P} d="M38 18.6l9.4-6-6.6 8.4ZM44 25l2-4.6.6 5Z"/>`,
  ankylo: `
    <path ${S} d="M14 32l-1 8h4l1.5-7ZM33 32v8h4l-.4-7Z"/>
    <path ${P} d="M15 29L6 26.4l-.6 3 9.4 3.4Z"/>
    <ellipse ${P} cx="5" cy="27.8" rx="4" ry="3.6"/>
    <path ${P} fill-rule="evenodd" d="M11 30c1-7 7.6-13 16-13.6 7.4-.6 12.8 3.8 14 9.2l2.6-.6 3 2.6.4 2.6-2.6 1.6-3.8-.2-1 1.2.4 7.6h-5.2l-.4-5.6c-5 1.2-10.4 1.4-15 .4l-1.2 5.2h-5.2l1.2-6.6C12.6 32.6 11.6 31.6 11 30Z${circlePath(43.4, 27.2, 0.9, true)}"/>
    <path ${P} d="M13.5 23.5l-2-3.2 4 1.6ZM18.5 18.6l-1.2-4 3.4 2.6ZM25 16.5l.4-4 2 3.8ZM32 17l2.4-3.4-.4 4.4ZM37.6 20.2l3.6-2.4-1.8 4Z"/>
    <path ${KL(1.8)} d="M15 25c5-5 15-7 23-1M18 29c5-3 13-4 19-1" stroke-opacity=".32"/>`,
  ptero: `
    <path ${P} d="M23 23L3 9.5c4.4 6.2 7 12.6 7.6 19.2L16 27l2.6 4.6 3.6-2.2L24 36l1.8-6.6 3.6 2.2L32 27l5.4 1.7c.6-6.6 3.2-13 7.6-19.2L25 23Z"/>
    <path ${P} d="M22.8 25.5l.6-6.4-6.6-7.4 7.4 3.8 2.6-1.4 10.6 1.4-10.2 1.8-1.6 2.4.4 5.8Z"/>
    <path ${K} d="M10.6 28.7L16 27l-5.4-12.6ZM37.4 28.7L32 27l5.4-12.6Z"/>`,
  trex: `
    <path ${S} d="M19 28l-3.6 7.6 2 6.4h-5.2l-.4-6.4 3-9Z"/>
    <path ${P} fill-rule="evenodd" d="M1 21.5c6-1.6 12-4 18-5.6 4.8-1.2 9.4-1.4 13.4-.8L35 9.6c.8-1.4 2.2-2.2 3.8-2.2h4.6c1.8 0 3.2 1.2 3.6 3l.4 3.6-.8 1.6-3.4.4 2.6.8-.6 1.6-6.2.4-2 2.4-.2 3 2.4 1.2.2 1.6-1.4.2-2.6-1.6-.8.4c-.2 3-1.6 5.4-4 7.2l1.2 7.6 3.6 1.8v1h-10l-.6-8.2-4.2-2.4C11 27.6 5.4 24.8 1 21.5Z${circlePath(40.6, 11.6, 1.1, true)}"/>`,

  // ---------------------------------------------------------------- ui
  heart: `
    <path ${P} d="M24 42.5C8 31.6 4 22.6 5.4 15.6 7 7.8 17.6 4.8 24 12.6c6.4-7.8 17-4.8 18.6 3 1.4 7-2.6 16-18.6 26.9Z"/>
    <path ${K} d="M24 42.5V12.6c6.4-7.8 17-4.8 18.6 3 1.4 7-2.6 16-18.6 26.9Z"/>
    <path ${S} d="M11.5 15.5c1-3 4-4.4 6.6-3.6"/>`,
  skull: `
    <path ${P} d="M24 4C13.4 4 6.5 11 6.5 20.5c0 6 2.8 10 7 12.2V39a2 2 0 0 0 2 2h17a2 2 0 0 0 2-2v-6.3c4.2-2.2 7-6.2 7-12.2C41.5 11 34.6 4 24 4Z"/>
    <circle ${K} cx="16.5" cy="22" r="4.8"/><circle ${K} cx="31.5" cy="22" r="4.8"/>
    <path ${K} d="M24 27.5l3 5h-6Z"/>
    <path ${KL(2.4)} d="M19.5 36v5M24 36v5M28.5 36v5"/>`,
  clock: `
    <circle ${P} cx="24" cy="25" r="19"/>
    <rect ${S} x="20" y="1.5" width="8" height="4" rx="1.4"/>
    <path ${KL(3.4)} d="M24 13.5V25l7.5 5"/>
    <circle ${KL(2)} cx="24" cy="25" r="14.5" stroke-opacity=".22"/>`,
  star: `<path ${P} d="${starPath(24, 25, 21.5, 9.2, 5)}"/>
    <path ${K} d="M24 3.5V34.3l13.3 7.1-2.6-15.3 11.1-10.6-15.3-2.2Z"/>`,
  'x-logo': `
    <rect x="2" y="2" width="44" height="44" rx="11" fill="#000"/>
    <rect x="2.75" y="2.75" width="42.5" height="42.5" rx="10.3" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5"/>
    <path fill="#fff" d="M12.5 12h8.2l15 24h-8.2Z"/>
    <path fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="square" d="M34.4 12.6L13.8 35.4"/>`,
  pause: `<rect ${P} x="10" y="7" width="10" height="34" rx="2.5"/><rect ${P} x="28" y="7" width="10" height="34" rx="2.5"/>`,
  sound: `
    <path ${P} d="M5 17h8l11-9v32l-11-9H5Z"/>
    <path ${L(3.4)} d="M30 17a9 9 0 0 1 0 14M35.5 11.5a17 17 0 0 1 0 25"/>`,
  settings: `<path ${P} fill-rule="evenodd" d="${gearPath(24, 24, 21, 15.5, 8)}${circlePath(24, 24, 6.5, true)}"/>
    <circle ${KL(2.2)} cx="24" cy="24" r="10.5" stroke-opacity=".3"/>`,

  // ---------------------------------------------------------------- extra ui glyphs
  warn: `<path ${P} d="M24 4.5c1.2 0 2.3.6 2.9 1.7l17.6 31c1.2 2.2-.4 4.9-2.9 4.9H6.4c-2.5 0-4.1-2.7-2.9-4.9l17.6-31c.6-1.1 1.7-1.7 2.9-1.7Z"/>
    <path ${K} d="M21.4 16h5.2l-1 13h-3.2ZM24 32a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z"/>`,
  reroll: `<path ${L(4)} d="M38 19a15 15 0 0 0-27-4M10 29a15 15 0 0 0 27 4"/>
    <path ${P} d="M7 6v12h12ZM41 42V30H29Z"/>`,
  play: `<path ${P} d="M13 6.5c0-1.6 1.7-2.5 3-1.7l26 17.5c1.2.8 1.2 2.6 0 3.4L16 43.2c-1.3.9-3-.1-3-1.7Z"/>`,
  help: `<circle ${P} cx="24" cy="24" r="20"/>
    <path ${KL(4)} d="M17.5 18.5a6.5 6.5 0 1 1 9.6 5.7c-1.8 1-3.1 2.4-3.1 4.5v1.3"/><circle ${K} cx="24" cy="36.5" r="2.6"/>`,
  close: `<path ${L(5)} d="M11 11l26 26M37 11L11 37"/>`,
  back: `<path ${L(5)} d="M28 9L13 24l15 15"/>`,
  bolt: bolt(10, 3, 2.1),
  flame: `<path ${P} d="M24 45c-9 0-15-6-15-14 0-8 6-12 8-20 4 3 5 7 5 10 3-3 4-9 3-17 10 6 16 15 16 26 0 9-7 15-17 15Z"/>
    <path ${K} d="M24 45c-4 0-7-3-7-7 0-4 3-6 5-10 1 3 3 4 4 4 1-2 1-4 1-6 3 3 5 7 5 12 0 4-3 7-8 7Z"/>`,
  target: `<circle ${L(3.4)} cx="24" cy="24" r="15"/><circle ${P} cx="24" cy="24" r="4"/>
    <path ${L(3.4)} d="M24 2v9M24 37v9M2 24h9M37 24h9"/>`,
  mouse: `<rect ${L(3.4)} x="11" y="4" width="26" height="40" rx="13"/><path ${P} d="M11.5 17A13 13 0 0 1 22.5 4.1V19H11.5Z"/><path ${L(3)} d="M24 9v8"/>`,
  touch: `<path ${P} d="M19 22V9a3.5 3.5 0 0 1 7 0v11l9.6 2.2c2.8.6 4.6 3.4 4 6.2L37.4 42a3 3 0 0 1-3 2.4H22.2c-1 0-2-.5-2.6-1.4L11 30.6a3.3 3.3 0 0 1 5.2-4l2.8 3.4Z"/>
    <path ${SL(2.6)} d="M12 10a10.5 10.5 0 0 1 21 0"/>`,
  trophy: `<path ${P} d="M13 5h22v11a11 11 0 0 1-22 0Z"/><path ${L(3)} d="M13 9H6v3a7 7 0 0 0 7 7M35 9h7v3a7 7 0 0 1-7 7"/>
    <rect ${P} x="21" y="26" width="6" height="9"/><rect ${P} x="14" y="35" width="20" height="7" rx="1.5"/><path ${K} d="M24 5h11v11a11 11 0 0 1-11 11Z"/>`,
  speed: `<path ${L(4)} d="M7 34a17 17 0 1 1 34 0"/><path ${P} d="M22 33.5L33 17l-7.5 18.5a2 2 0 0 1-3.5-2Z"/><circle ${P} cx="24" cy="34" r="3.4"/>`,
  dna: `<path ${L(3.4)} d="M15 4c0 10 18 10 18 20s-18 10-18 20M33 4c0 10-18 10-18 20s18 10 18 20"/><path ${SL(2.6)} d="M18 10h12M18 38h12M20.5 17h7M20.5 31h7"/>`,
};

export const ICON_IDS = Object.keys(ICONS);

const ALIASES = { 'x': 'x-logo', xlogo: 'x-logo', storm: 'storm_gatling', rail: 'railgun', skyhammer: 'airstrike', special: 'airstrike', xp: 'gem', gene: 'gem', medkit: 'repair', heal: 'repair', ankylosaurus: 'ankylo', triceratops: 'trike', pteranodon: 'ptero', tyrannosaurus: 'trex', settings_gear: 'settings', gear: 'settings', kills: 'skull', time: 'clock' };

export function hasIcon(id) {
  return !!(ICONS[id] || ICONS[ALIASES[id]]);
}

/**
 * @param {string} id icon id (see ICON_IDS)
 * @param {{size?: number|string, cls?: string, title?: string}} [opts]
 * @returns {string} inline SVG markup
 */
export function iconSVG(id, opts = {}) {
  const body = ICONS[id] || ICONS[ALIASES[id]] || ICONS.star;
  const size = opts.size != null ? ` width="${opts.size}" height="${opts.size}"` : '';
  const cls = `ico ico-${String(id).replace(/[^a-z0-9_-]/gi, '')}${opts.cls ? ' ' + String(opts.cls).replace(/[<>"]/g, '') : ''}`;
  const a11y = opts.title
    ? ` role="img" aria-label="${String(opts.title).replace(/[<>"&]/g, '')}"`
    : ' aria-hidden="true" focusable="false"';
  return `<svg class="${cls}" viewBox="0 0 48 48"${size}${a11y} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

const _tpl = typeof document !== 'undefined' ? document.createElement('template') : null;

/** @returns {SVGElement} */
export function iconEl(id, opts = {}) {
  _tpl.innerHTML = iconSVG(id, opts);
  return _tpl.content.firstElementChild;
}
