import { iconSVG } from './icons.js';
import { describeChoice } from './upgrades.js';

// js/game/hud.js
// DOM HUD and screens: hull / nitro / XP bars, timer, score + combo, build slots, Skyhammer charge ring, boss bar,
// banners, prompts, warnings, the boss name card, the level-up cards, pause and the results screen.

const $ = (id) => document.getElementById(id);

function fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

class HUD {
  constructor(game) {
    this.game = game;
    for (const el of document.querySelectorAll('.ico-slot')) el.innerHTML = iconSVG(el.dataset.icon);
    this.el = {
      level: $('h-level'), xp: document.querySelector('.xp-fill'), xpWrap: document.querySelector('.xp'),
      hp: $('h-hp'), hull: document.querySelector('.bar.hull'), hullFill: document.querySelector('.hull .bar-fill'), hullGhost: document.querySelector('.hull .bar-ghost'),
      nitro: document.querySelector('.bar.nitro'), nitroFill: document.querySelector('.nitro .bar-fill'),
      time: $('h-time'), wave: $('h-wave'), score: $('h-score'), kills: $('h-kills'),
      combo: $('h-combo'), comboN: $('h-combo-n'), mult: $('h-mult'), comboBar: document.querySelector('.combo-bar i'),
      build: $('h-build'), special: $('h-special'), specialFill: document.querySelector('.special .fill'),
      loc: $('h-loc'), bossbar: $('bossbar'), bName: $('b-name'), bSub: $('b-sub'), bPhase: $('b-phase'),
      bFill: document.querySelector('.boss-fill'), bGhost: document.querySelector('.boss-ghost'),
      banner: $('banner'), prompt: $('prompt'), warning: $('warning'), hint: $('hint'), namecard: $('namecard'),
      reticle: $('reticle'), lock: $('lock'), flash: $('flash')
    };
    this.cache = {};
    this.buildKey = '';
    this.bannerQueue = [];
    this.bannerT = 0;
    this.promptT = 0;
    this.bossTarget = null;
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
    this._set('level', el.level, String(g.level));
    this._style('xp', el.xp, 'width', `${Math.min(100, (g.xp / g.xpNeed) * 100).toFixed(1)}%`);
    const hpf = Math.max(0, p.hp / p.maxHp);
    this._set('hp', el.hp, String(Math.ceil(p.hp)));
    this._style('hullFill', el.hullFill, 'transform', `scaleX(${hpf.toFixed(3)})`);
    this._style('hullGhost', el.hullGhost, 'transform', `scaleX(${hpf.toFixed(3)})`);
    el.hull.classList.toggle('low', hpf < 0.3);
    this._style('nitro', el.nitroFill, 'transform', `scaleX(${p.nitro.toFixed(3)})`);
    el.nitro.classList.toggle('on', p.boosting);
    this._set('time', el.time, fmtTime(g.director.time));
    const w = g.director;
    this._set('wave', el.wave, w.bossActive ? 'APEX SPECIMEN' : w.bossDone && !w.endless ? 'APEX DOWN' : w.endless ? `ENDLESS · ${fmtTime(w.endlessT)}` : `WAVE ${w.waveNumber} · BOSS IN ${fmtTime(Math.max(0, w.bossTime - w.time))}`);
    this._set('score', el.score, g.score.toLocaleString('en-US'));
    this._set('kills', el.kills, g.stats.kills.toLocaleString('en-US'));
    const comboOn = g.combo >= 5;
    el.combo.classList.toggle('on', comboOn);
    if (comboOn) {
      this._set('comboN', el.comboN, String(g.combo));
      this._set('mult', el.mult, `x${g.comboMult()}`);
      this._style('comboBar', el.comboBar, 'transform', `scaleX(${Math.max(0, g.comboT / 2.5).toFixed(2)})`);
    }
    const ch = g.weapons.special.charge;
    this._style('special', el.specialFill, 'strokeDashoffset', String((213.6 * (1 - ch)).toFixed(1)));
    el.special.classList.toggle('ready', ch >= 1);
    if (this.tSpecial || (this.tSpecial = document.getElementById('t-special'))) {
      this._style('tSpecial', this.tSpecial, '--charge', ch.toFixed(2));
      this.tSpecial.classList.toggle('ready', ch >= 1);
    }
    this._set('loc', el.loc, g.route.legName(p.s));
    // Build slots
    const list = g.weapons.buildList();
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

  prompt(text, kind = '') {
    if (this.promptT > 0 && this.el.prompt.textContent === text) return;
    const el = this.el.prompt;
    el.className = '';
    el.textContent = text;
    void el.offsetWidth;
    el.className = `on ${kind}`;
    this.promptT = 0.9;
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

  hurt() {
    const h = this.el.hull;
    h.classList.remove('hit');
    void h.offsetWidth;
    h.classList.add('hit');
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
    $('r-best').textContent = r.newBest ? 'NEW PERSONAL BEST' : r.best ? `BEST ${r.best.toLocaleString('en-US')}` : '';
    const stats = [
      [fmtTime(r.time), 'Survived'], [r.kills.toLocaleString('en-US'), 'Fossilized'], [String(r.level), 'Level'],
      [String(r.maxCombo), 'Max combo'], [r.roadkill.toLocaleString('en-US'), 'Roadkill'], [r.bossTime ? fmtTime(r.bossTime) : r.boss ? 'YES' : '—', r.bossTime ? 'Rex kill time' : 'Apex down']
    ];
    $('r-stats').innerHTML = stats.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    $('r-build').innerHTML = r.build.map((b) => this.slotHTML(b)).join('');
    $('btn-endless').style.display = r.win && !r.endless ? '' : 'none';
    // Count-up score
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

  /** Reticle + lock-on brackets (screen px) */
  reticle(x, y, firing, lock) {
    const r = this.el.reticle;
    r.style.transform = `translate(${x}px, ${y}px)`;
    r.classList.toggle('firing', firing);
    const l = this.el.lock;
    if (lock) {
      l.style.transform = `translate(${lock.x}px, ${lock.y}px) scale(${lock.s})`;
      l.classList.add('on');
      l.classList.toggle('weak', !!lock.weak);
      r.classList.toggle('weak', !!lock.weak);
    } else {
      l.classList.remove('on');
      r.classList.remove('weak');
    }
  }

  hitmark() {
    const r = this.el.reticle;
    r.classList.add('hit');
    clearTimeout(this._hm);
    this._hm = setTimeout(() => r.classList.remove('hit'), 70);
  }
}

export { HUD, fmtTime };
