import { iconSVG } from './icons.js';
import { describeChoice } from './upgrades.js';

// js/game/hud.js
// DOM HUD and screens for the arcade rail shooter: the big crosshair (hit markers, heat bloom, red over a dinosaur,
// gold over a weak point), the AMMO belt with RELOAD! warnings, hull / XP bars, score + combo multiplier, build slots,
// Skyhammer charge ring, boss bar, banners, arcade CALLOUTS (DANGER! STAGGER! GO GO GO!), cracked-glass hits and the
// red damage flash, the boss name card, the level-up cards, pause, the CONTINUE? countdown and the results screen.

const $ = (id) => document.getElementById(id);

function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Cracked-glass splat (spider web), drawn once, positioned per hit
const CRACK_SVG = (() => {
  let d = '';
  const rays = 11;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + Math.sin(i * 7.3) * 0.22;
    let x = 50, y = 50;
    d += `M50 50`;
    for (let k = 1; k <= 4; k++) {
      const r = k * 12 + Math.sin(i * 3.1 + k) * 4;
      x = 50 + Math.cos(a + Math.sin(i + k) * 0.12) * r;
      y = 50 + Math.sin(a + Math.sin(i + k) * 0.12) * r;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  for (const r of [10, 22, 34]) {
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * Math.PI * 2, a1 = ((i + 1) / rays) * Math.PI * 2;
      if ((i * 5 + r) % 3 === 0) continue;
      d += ` M${(50 + Math.cos(a0) * r).toFixed(1)} ${(50 + Math.sin(a0) * r).toFixed(1)} L${(50 + Math.cos(a1) * (r + 3)).toFixed(1)} ${(50 + Math.sin(a1) * (r + 3)).toFixed(1)}`;
    }
  }
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="5" /><path d="${d}" /></svg>`;
})();

class HUD {
  constructor(game) {
    this.game = game;
    for (const el of document.querySelectorAll('.ico-slot')) el.innerHTML = iconSVG(el.dataset.icon);
    this.el = {
      level: $('h-level'), xp: document.querySelector('.xp-fill'), xpWrap: document.querySelector('.xp'),
      hp: $('h-hp'), hull: document.querySelector('.bar.hull'), hullFill: document.querySelector('.hull .bar-fill'), hullGhost: document.querySelector('.hull .bar-ghost'),
      time: $('h-time'), wave: $('h-wave'), score: $('h-score'), kills: $('h-kills'),
      combo: $('h-combo'), comboN: $('h-combo-n'), mult: $('h-mult'), comboBar: document.querySelector('.combo-bar i'),
      build: $('h-build'), special: $('h-special'), specialFill: document.querySelector('.special .fill'),
      loc: $('h-loc'), bossbar: $('bossbar'), bName: $('b-name'), bSub: $('b-sub'), bPhase: $('b-phase'),
      bFill: document.querySelector('.boss-fill'), bGhost: document.querySelector('.boss-ghost'),
      banner: $('banner'), prompt: $('prompt'), warning: $('warning'), hint: $('hint'), namecard: $('namecard'),
      reticle: $('reticle'), flash: $('flash'), callout: $('callout'), cracks: $('cracks'), redflash: $('redflash'),
      ammo: $('ammo'), ammoN: $('ammo-n'), ammoBelt: $('ammo-belt'), ammoMax: $('ammo-max'), reload: $('reload-bar'), mult2: $('h-mult-big')
    };
    this.cache = {};
    this.buildKey = '';
    this.bannerQueue = [];
    this.bannerT = 0;
    this.promptT = 0;
    this.calloutT = 0;
    this.bossTarget = null;
    this.cracks = [];
    this.beltN = -1;
  }

  _set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  _style(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const el = this.el;
    const w = g.weapons;
    this._set('level', el.level, String(g.level));
    this._style('xp', el.xp, 'width', `${Math.min(100, (g.xp / g.xpNeed) * 100).toFixed(1)}%`);
    const hpf = Math.max(0, p.hp / p.maxHp);
    this._set('hp', el.hp, String(Math.ceil(p.hp)));
    this._style('hullFill', el.hullFill, 'transform', `scaleX(${hpf.toFixed(3)})`);
    this._style('hullGhost', el.hullGhost, 'transform', `scaleX(${hpf.toFixed(3)})`);
    el.hull.classList.toggle('low', hpf < 0.3);
    this._set('time', el.time, fmtTime(g.director.time));
    this._set('wave', el.wave, g.director.stageName);
    this._set('score', el.score, g.score.toLocaleString('en-US'));
    this._set('kills', el.kills, g.stats.kills.toLocaleString('en-US'));
    const comboOn = g.combo >= 3;
    el.combo.classList.toggle('on', comboOn);
    if (comboOn) {
      this._set('comboN', el.comboN, String(g.combo));
      this._set('mult', el.mult, `x${g.comboMult()}`);
      this._style('comboBar', el.comboBar, 'transform', `scaleX(${Math.max(0, g.comboT / 3.2).toFixed(2)})`);
    }
    // Ammo belt
    const mag = w.magSize;
    if (mag !== this.beltN) {
      this.beltN = mag;
      const cells = Math.min(mag, 45);
      el.ammoBelt.innerHTML = Array.from({ length: cells }, () => '<i></i>').join('');
      this._set('ammoMax', el.ammoMax, `/${mag}`);
    }
    const reloading = w.reloadT > 0;
    this._set('ammoN', el.ammoN, w.overdrive > 0 ? '∞' : reloading ? '--' : String(w.ammo));
    const cells = el.ammoBelt.children.length;
    const lit = reloading ? 0 : Math.ceil((w.ammo / mag) * cells);
    if (this.cache.lit !== lit) {
      this.cache.lit = lit;
      for (let i = 0; i < cells; i++) el.ammoBelt.children[i].className = i < lit ? 'on' : '';
    }
    el.ammo.classList.toggle('low', !reloading && w.ammo / mag <= 0.2 && w.overdrive <= 0);
    el.ammo.classList.toggle('reloading', reloading);
    el.ammo.classList.toggle('overdrive', w.overdrive > 0);
    this._style('reload', el.reload, 'transform', `scaleX(${reloading ? (1 - w.reloadT / w.reloadDur).toFixed(3) : 0})`);
    const ch = w.special.charge;
    this._style('special', el.specialFill, 'strokeDashoffset', String((213.6 * (1 - ch)).toFixed(1)));
    el.special.classList.toggle('ready', ch >= 1);
    if (this.tSpecial || (this.tSpecial = document.getElementById('t-special'))) {
      this._style('tSpecial', this.tSpecial, '--charge', ch.toFixed(2));
      this.tSpecial.classList.toggle('ready', ch >= 1);
    }
    this._set('loc', el.loc, g.route.legName(p.s));
    // Build slots
    const list = w.buildList();
    const key = list.map((b) => `${b.id}${b.level}`).join(',');
    if (key !== this.buildKey) {
      const prev = this.buildKey;
      this.buildKey = key;
      el.build.innerHTML = list.map((b) => this.slotHTML(b, !prev.includes(`${b.id}`))).join('');
    }
    // Boss bar
    const bt = this.bossTarget;
    if (bt) {
      if (!bt.alive || bt.hp <= 0) {
        if (!this.bossHideT) this.bossHideT = 1.2;
      }
      const f = Math.max(0, bt.hp / bt.maxHp);
      this._style('bFill', el.bFill, 'transform', `scaleX(${f.toFixed(4)})`);
      this._style('bGhost', el.bGhost, 'transform', `scaleX(${f.toFixed(4)})`);
      if (this.bossHideT) {
        this.bossHideT -= dt;
        if (this.bossHideT <= 0) this.hideBoss();
      }
    }
    // Banners queue
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.bannerT <= 0 && this.bannerQueue.length) this._showBanner(this.bannerQueue.shift());
    if (this.promptT > 0) this.promptT -= dt;
    if (this.calloutT > 0) { this.calloutT -= dt; if (this.calloutT <= 0) el.callout.className = ''; }
    // Persistent callouts: RELOAD! while reloading / empty
    if (reloading && this.calloutT <= 0 && w.overdrive <= 0) this.callout('RELOAD!', 'reload', 0.5);
    if (!reloading && w.ammo > 0 && el.callout.textContent === 'RELOAD!' && this.calloutT > 0) { this.calloutT = 0; el.callout.className = ''; }
    // Cracks fade
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i];
      c.t -= dt;
      c.el.style.opacity = String(Math.max(0, Math.min(1, c.t / 1.2)) * 0.9);
      if (c.t <= 0) { c.el.remove(); this.cracks.splice(i, 1); }
    }
  }

  slotHTML(b, isNew = false) {
    const lv = b.level === 'EVO' ? 'EVO' : b.level;
    return `<div class="slot ${b.kind}${b.evolved ? ' evo' : ''}${isNew ? ' new' : ''}" style="--c:${b.color}" title="${b.name}">${iconSVG(b.icon)}<span class="lv">${lv}</span></div>`;
  }

  // ------------------------------------------------------------------------------------------------------------------
  banner(title, sub = '', kind = 'wave', priority = false) {
    const item = { title, sub, kind };
    if (priority) { this.bannerQueue.unshift(item); this.bannerT = 0; } else this.bannerQueue.push(item);
    if (this.bannerQueue.length > 3) this.bannerQueue.splice(1, this.bannerQueue.length - 3);
  }

  _showBanner({ title, sub, kind }) {
    const b = this.el.banner;
    b.className = '';
    b.querySelector('.b-title').textContent = title;
    const s = b.querySelector('.b-sub');
    s.textContent = sub || '';
    s.style.display = sub ? '' : 'none';
    void b.offsetWidth;
    b.className = `on ${kind}`;
    this.bannerT = kind === 'combo' ? 1.2 : 2.2;
  }

  /** Big arcade callout in the middle of the screen: DANGER! RELOAD! STAGGER! GO GO GO! */
  callout(text, kind = '', dur = 0.9) {
    const el = this.el.callout;
    if (this.calloutT > 0 && el.textContent === text) { this.calloutT = Math.max(this.calloutT, dur); return; }
    // Danger outranks the reload nag
    if (this.calloutT > 0.3 && kind === 'reload' && /danger/.test(el.className)) return;
    el.className = '';
    el.textContent = text;
    void el.offsetWidth;
    el.className = `on ${kind}`;
    this.calloutT = dur;
  }

  prompt(text, kind = '') {
    if (this.promptT > 0 && this.el.prompt.textContent === text) return;
    const el = this.el.prompt;
    el.className = '';
    el.textContent = text;
    void el.offsetWidth;
    el.className = `on ${kind}`;
    this.promptT = 1.2;
  }

  hint(html, on = true) {
    const el = this.el.hint;
    if (html) el.innerHTML = html;
    el.classList.toggle('on', on);
  }

  warning(sub) {
    const el = this.el.warning;
    el.querySelector('.w-sub').textContent = sub;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  nameCard(kicker, name, sub) {
    const el = this.el.namecard;
    el.querySelector('.nc-kicker').textContent = kicker;
    el.querySelector('.nc-name').textContent = name;
    el.querySelector('.nc-sub').textContent = sub;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  showBoss(e, name, sub, mini = false) {
    this.bossTarget = e;
    this.bossHideT = 0;
    const el = this.el;
    el.bName.textContent = name;
    el.bSub.textContent = sub;
    el.bPhase.textContent = mini ? 'MINI-BOSS' : 'PHASE 1';
    el.bossbar.classList.toggle('mini', mini);
    el.bossbar.classList.remove('hidden');
    this.cache.bFill = this.cache.bGhost = null;
  }

  setBossPhase(n) {
    this.el.bPhase.textContent = `PHASE ${n}`;
  }

  hideBoss() {
    this.bossTarget = null;
    this.bossHideT = 0;
    this.el.bossbar.classList.add('hidden');
  }

  /** Player took a hit: hull shake, red flash, cracked glass where it came from, damage number */
  hurt(dmg, sx = 0.5, sy = 0.6, kind = '') {
    const h = this.el.hull;
    h.classList.remove('hit');
    void h.offsetWidth;
    h.classList.add('hit');
    const r = this.el.redflash;
    r.classList.remove('on');
    void r.offsetWidth;
    r.classList.add('on');
    this.crack(sx, sy, Math.min(1.6, 0.7 + dmg * 0.05));
    const n = document.createElement('div');
    n.className = 'dmg-pop';
    n.textContent = `-${Math.round(dmg)}`;
    n.style.left = `${(sx * 100).toFixed(1)}%`;
    n.style.top = `${(sy * 100).toFixed(1)}%`;
    this.el.cracks.appendChild(n);
    setTimeout(() => n.remove(), 900);
    void kind;
  }

  crack(sx, sy, size = 1) {
    if (this.cracks.length > 6) { const c = this.cracks.shift(); c.el.remove(); }
    const el = document.createElement('div');
    el.className = 'crack';
    el.innerHTML = CRACK_SVG;
    el.style.left = `${(sx * 100).toFixed(1)}%`;
    el.style.top = `${(sy * 100).toFixed(1)}%`;
    el.style.setProperty('--s', size.toFixed(2));
    el.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
    this.el.cracks.appendChild(el);
    this.cracks.push({ el, t: 3.2 });
  }

  clearCracks() {
    for (const c of this.cracks) c.el.remove();
    this.cracks.length = 0;
  }

  healFlash() {
    const h = this.el.hull;
    h.classList.remove('heal');
    void h.offsetWidth;
    h.classList.add('heal');
  }

  ammoPulse() {
    const a = this.el.ammo;
    a.classList.remove('pulse');
    void a.offsetWidth;
    a.classList.add('pulse');
  }

  flash(a) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = String(a);
    void f.offsetWidth;
    f.style.transition = 'opacity 0.6s ease-out';
    f.style.opacity = '0';
  }

  // ------------------------------------------------------------------------------------------------------------------
  showContinue(score, continues) {
    $('c-score').textContent = score.toLocaleString('en-US');
    $('c-note').textContent = continues ? `Continues used: ${continues} · continuing resets your combo multiplier` : 'FREE PLAY · continuing resets your combo multiplier';
    $('s-continue').classList.add('open');
  }

  continueCount(n) {
    const el = $('c-count');
    el.textContent = String(n);
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }

  hideContinue() {
    $('s-continue').classList.remove('open');
  }

  showLevelUp(choices, build, { title = 'CHOOSE AN UPGRADE', kicker = `LEVEL ${build.level}`, crate = false, rerolls = 0 } = {}, onPick) {
    const s = $('s-levelup');
    s.classList.toggle('crate', crate);
    $('lu-kicker').textContent = kicker;
    $('lu-title').textContent = title;
    $('lu-rerolls').textContent = String(rerolls);
    $('lu-reroll').disabled = rerolls <= 0;
    const cards = $('lu-cards');
    cards.innerHTML = '';
    choices.forEach((c, i) => {
      const d = describeChoice(c, build);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card ${c.kind}`;
      btn.style.setProperty('--c', d.color);
      let pips = '';
      if (d.max) {
        pips = '<div class="c-pips">' + Array.from({ length: d.max }, (_, k) => `<i class="${k < d.level - 1 ? 'on' : k === d.level - 1 ? 'next' : ''}"></i>`).join('') + '</div>';
      }
      btn.innerHTML = `<kbd class="c-key">${i + 1}</kbd><div class="c-icon">${iconSVG(d.icon)}</div><div class="c-badge">${d.badge}</div><div class="c-title">${d.title}</div><div class="c-desc">${d.desc}</div>${d.sub ? `<div class="c-sub">${d.sub}</div>` : ''}${pips}`;
      btn.addEventListener('click', () => onPick(i));
      btn.addEventListener('pointerenter', () => this.game.audio.play('ui_hover'));
      cards.appendChild(btn);
    });
    s.classList.add('open');
  }

  hideLevelUp() {
    $('s-levelup').classList.remove('open');
  }

  open(id, on = true) {
    $(id).classList.toggle('open', on);
  }

  showResults(r) {
    const s = $('s-results');
    s.classList.toggle('win', r.win);
    $('r-kicker').textContent = r.win ? 'SHIFT REPORT · UNIT 77 · APEX DOWN' : 'SHIFT REPORT · UNIT 77';
    $('r-title').textContent = r.title;
    $('r-sub').textContent = r.sub;
    $('r-best').textContent = r.newBest ? 'NEW HI-SCORE' : r.best ? `HI-SCORE ${r.best.toLocaleString('en-US')}` : '';
    const stats = [
      [fmtTime(r.time), 'Time'], [r.kills.toLocaleString('en-US'), 'Fossilized'], [String(r.headshots), 'Headshots'],
      [String(r.maxCombo), 'Max combo'], [String(r.continues), 'Continues'], [r.bossTime ? fmtTime(r.bossTime) : r.boss ? 'YES' : '—', r.bossTime ? 'Rex kill time' : 'Apex down']
    ];
    $('r-stats').innerHTML = stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    $('r-build').innerHTML = r.build.map((b) => this.slotHTML(b)).join('');
    $('btn-endless').style.display = r.win && !r.endless ? '' : 'none';
    const target = r.score;
    const el = $('r-score');
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1400);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString('en-US');
      if (k < 1 && s.classList.contains('open')) requestAnimationFrame(step);
    };
    s.classList.add('open');
    requestAnimationFrame(step);
    el.textContent = '0';
  }

  /** Crosshair (screen px). state: null | 'enemy' | 'weak'; heat 0..1 opens the brackets */
  reticle(x, y, firing, state, heat = 0) {
    const r = this.el.reticle;
    r.style.transform = `translate(${x}px, ${y}px)`;
    this._style('heat', r, '--heat', heat.toFixed(2));
    r.classList.toggle('firing', firing);
    r.classList.toggle('enemy', state === 'enemy');
    r.classList.toggle('weak', state === 'weak');
  }

  hitmark(weak = false, killed = false) {
    const r = this.el.reticle;
    r.classList.remove('hit', 'hitweak', 'kill');
    void r.offsetWidth;
    r.classList.add(weak ? 'hitweak' : 'hit');
    if (killed) r.classList.add('kill');
    clearTimeout(this._hm);
    this._hm = setTimeout(() => r.classList.remove('hit', 'hitweak', 'kill'), 110);
  }
}

export { HUD, fmtTime };
