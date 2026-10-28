// js/game/upgrades.js
// Every upgrade the level-up screen can offer: 8 weapons (the Tail Gun is the aimed main gun the run starts with),
// 8 passives, and 8 evolutions (a weapon at max level + its paired passive → an evolved weapon that replaces it).
// Rules (Vampire Survivors-style): 6 weapon slots, 6 passive slots, 3 choices per level-up (4 with luck), evolutions
// are offered with priority once unlocked, rerolls are limited.

const MAX_WEAPONS = 6;
const MAX_PASSIVES = 6;

const WEAPONS = {
  cannon: {
    name: 'Tail Gun', icon: 'cannon', color: '#2cf6ff', max: 5, evo: 'railgun', evoNeeds: 'hollow',
    blurb: 'Your aimed minigun. Hold it down.',
    levels: ['Aimed minigun. Headshots deal 1.6x.', '+30% damage.', '100-round belt, rounds pierce +1 dinosaur.', '+22% fire rate.', 'Every 8th round bursts.']
  },
  gatling: {
    name: 'Sentry Guns', icon: 'gatling', color: '#ffd23a', max: 5, evo: 'storm_gatling', evoNeeds: 'loader',
    blurb: 'Twin roof sentries auto-target the nearest pursuer.',
    levels: ['Twin roof sentries lock onto the nearest dinosaur.', '+35% damage.', '+40% fire rate.', '+35% damage, +10 m range.', '+40% fire rate, rounds pierce.']
  },
  saws: {
    name: 'Hubcap Saws', icon: 'saws', color: '#ff9a2c', max: 5, evo: 'buzzsaw', evoNeeds: 'ram',
    blurb: 'Spinning blades whirl behind the cab.',
    levels: ['2 saw blades whirl through the road behind you.', '+1 blade.', '+40% damage.', '+1 blade, wider orbit.', '+1 blade, faster spin.']
  },
  missiles: {
    name: 'Swarm Missiles', icon: 'missiles', color: '#ff5a3c', max: 5, evo: 'cluster', evoNeeds: 'boom',
    blurb: 'Homing rockets seek out the biggest prey.',
    levels: ['Launches 2 homing missiles.', '+1 missile.', '+35% damage.', '+1 missile, faster reload.', '+1 missile, bigger blasts.']
  },
  tesla: {
    name: 'Tesla Coil', icon: 'tesla', color: '#5cc8ff', max: 5, evo: 'thunder', evoNeeds: 'magnet',
    blurb: 'Lightning arcs between dinosaurs.',
    levels: ['Zaps a dinosaur and chains to 2 more.', '+1 chain.', '+35% damage.', '+2 chains, faster recharge.', '+2 chains, +40% damage.']
  },
  flamer: {
    name: 'Exhaust Flamer', icon: 'flamer', color: '#ff7a1a', max: 5, evo: 'inferno', evoNeeds: 'turbo',
    blurb: 'Torches anything tailgating you.',
    levels: ['Rear flamethrower sets pursuers ablaze.', '+30% range.', '+40% damage.', '+30% range, longer burns.', '+50% damage.']
  },
  mines: {
    name: 'Flare Mines', icon: 'mines', color: '#ff3b6b', max: 5, evo: 'nova', evoNeeds: 'armor',
    blurb: 'Drops proximity mines in your wake.',
    levels: ['Drops a proximity mine behind the cab.', '+40% damage.', 'Drops mines faster.', '+30% blast radius.', 'Drops 2 mines at a time.']
  },
  shotgun: {
    name: 'Tailgate Buckshot', icon: 'shotgun', color: '#ffe066', max: 5, evo: 'dragon', evoNeeds: 'chassis',
    blurb: 'Point-blank blast at anything on your bumper.',
    levels: ['Rear buckshot blast at close pursuers, heavy knockback.', '+3 pellets.', '+35% damage.', 'Fires faster.', '+4 pellets, +35% damage.']
  }
};

const EVOLUTIONS = {
  railgun: { from: 'cannon', name: 'Rail Lance', icon: 'railgun', color: '#7dfcff', desc: 'Your gun becomes a rail lance: 70-damage slugs pierce every dinosaur in a line.' },
  storm_gatling: { from: 'gatling', name: 'Storm Gatlings', icon: 'storm_gatling', color: '#ffe14d', desc: 'A wall of lead in every direction. Rounds pierce 3.' },
  buzzsaw: { from: 'saws', name: 'Buzzsaw Halo', icon: 'buzzsaw', color: '#ffb347', desc: '8 molten blades on a wide orbit that hurl dinosaurs aside.' },
  cluster: { from: 'missiles', name: 'Cluster Barrage', icon: 'cluster', color: '#ff7a5c', desc: '8 missiles per salvo, each splitting into 4 bomblets.' },
  thunder: { from: 'tesla', name: 'Thunderhead', icon: 'thunder', color: '#9fe2ff', desc: 'Chains forever-ish and calls lightning strikes from the sky.' },
  inferno: { from: 'flamer', name: 'Inferno Wake', icon: 'inferno', color: '#ff5a1a', desc: 'Leaves a burning trail that roasts the whole stampede.' },
  nova: { from: 'mines', name: 'Nova Mines', icon: 'nova', color: '#7c5cff', desc: 'Plasma novas that vaporize everything in a huge radius.' },
  dragon: { from: 'shotgun', name: "Dragon's Breath", icon: 'dragon', color: '#ff8a3c', desc: 'Incendiary buckshot: 16 burning pellets that explode on hit. +1 hull/s repair.' }
};

const PASSIVES = {
  armor: { name: 'Armor Plating', icon: 'armor', color: '#a6b4c8', max: 5, desc: (l) => `Reduce damage taken by ${l} per hit.` },
  chassis: { name: 'Reinforced Chassis', icon: 'chassis', color: '#5ee08f', max: 5, desc: () => '+20 max hull, +0.35 hull/s self-repair.' },
  turbo: { name: 'Extended Mag', icon: 'turbo', color: '#ffb02e', max: 5, desc: () => '+20% Tail Gun magazine, 10% faster reload.' },
  magnet: { name: 'Gene Magnet', icon: 'magnet', color: '#2cf6ff', max: 5, desc: () => '+12% gene energy (XP) from every core.' },
  ram: { name: 'Stopping Power', icon: 'ram', color: '#ffd23a', max: 5, desc: () => '+25% stagger: your shots knock attackers out of their lunge sooner.' },
  loader: { name: 'Autoloader', icon: 'loader', color: '#ff7ad9', max: 5, desc: () => 'Weapons fire and recharge 8% faster.' },
  hollow: { name: 'Hollow Points', icon: 'hollow', color: '#ff5a5a', max: 5, desc: () => '+12% damage, +3% crit chance.' },
  boom: { name: 'Blast Radius', icon: 'boom', color: '#ff9a2c', max: 5, desc: () => '+12% area for blasts, saws and flames.' }
};

/** Builds the list of offerable choices given the current build. Returns up to n distinct choices. */
function rollChoices(build, n = 3, rng = Math.random) {
  const pool = [];
  const weapons = build.weapons; // Map id -> level
  const passives = build.passives;
  const evolved = build.evolved; // Set of evolution ids
  // Evolutions first (guaranteed slot)
  const evos = [];
  for (const [evoId, evo] of Object.entries(EVOLUTIONS)) {
    if (evolved.has(evoId)) continue;
    const base = WEAPONS[evo.from];
    if ((weapons.get(evo.from) || 0) >= base.max && passives.has(base.evoNeeds)) evos.push({ kind: 'evolution', id: evoId, weight: 100 });
  }
  for (const [id, w] of Object.entries(WEAPONS)) {
    const lvl = weapons.get(id) || 0;
    if (evolved.has(w.evo)) continue;
    if (lvl === 0 && weapons.size + evolved.size >= MAX_WEAPONS) continue;
    if (lvl >= w.max) continue;
    // Early on, favour new weapons so builds come together quickly
    const weight = lvl === 0 ? (build.level < 6 ? 14 : 8) : 10;
    pool.push({ kind: 'weapon', id, weight });
  }
  for (const [id, p] of Object.entries(PASSIVES)) {
    const lvl = passives.get(id) || 0;
    if (lvl === 0 && passives.size >= MAX_PASSIVES) continue;
    if (lvl >= p.max) continue;
    // Passives that complete an evolution for an owned weapon are more likely
    const completes = Object.values(WEAPONS).some((w) => w.evoNeeds === id && weapons.has(Object.keys(WEAPONS).find((k) => WEAPONS[k] === w)));
    pool.push({ kind: 'passive', id, weight: (completes ? 9 : 6) + (lvl > 0 ? 1 : 0) });
  }
  const out = evos.slice(0, 1);
  while (out.length < n && pool.length) {
    let total = 0;
    for (const c of pool) total += c.weight;
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].weight; if (r <= 0) break; }
    idx = Math.min(idx, pool.length - 1);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  if (out.length === 0) {
    out.push({ kind: 'bonus', id: 'repair' }, { kind: 'bonus', id: 'bounty' });
  }
  return out;
}

/** Card text for a choice */
function describeChoice(c, build) {
  if (c.kind === 'evolution') {
    const e = EVOLUTIONS[c.id];
    return { title: e.name, icon: e.icon, color: e.color, badge: 'EVOLUTION', desc: e.desc, sub: `${WEAPONS[e.from].name} + ${PASSIVES[WEAPONS[e.from].evoNeeds].name}` };
  }
  if (c.kind === 'weapon') {
    const w = WEAPONS[c.id];
    const lvl = (build.weapons.get(c.id) || 0) + 1;
    return {
      title: w.name, icon: w.icon, color: w.color, badge: lvl === 1 ? 'NEW WEAPON' : `LV ${lvl}`, level: lvl, max: w.max,
      desc: w.levels[lvl - 1], sub: `Evolves with ${PASSIVES[w.evoNeeds].name}`
    };
  }
  if (c.kind === 'passive') {
    const p = PASSIVES[c.id];
    const lvl = (build.passives.get(c.id) || 0) + 1;
    const evoFor = Object.entries(WEAPONS).find(([, w]) => w.evoNeeds === c.id);
    return {
      title: p.name, icon: p.icon, color: p.color, badge: lvl === 1 ? 'NEW' : `LV ${lvl}`, level: lvl, max: p.max,
      desc: p.desc(lvl), sub: evoFor ? `Evolves ${evoFor[1].name}` : ''
    };
  }
  if (c.id === 'repair') return { title: 'Field Repair', icon: 'repair', color: '#5ee08f', badge: 'BONUS', desc: 'Restore 40% hull.' };
  return { title: 'Gene Bounty', icon: 'score', color: '#ffd23a', badge: 'BONUS', desc: '+5,000 score.' };
}

export { WEAPONS, PASSIVES, EVOLUTIONS, MAX_WEAPONS, MAX_PASSIVES, rollChoices, describeChoice };
