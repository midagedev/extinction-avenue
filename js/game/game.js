import * as THREE from 'three/webgpu';
import { createWorld } from './world.js';
import { ASSET_MANIFEST, loadAssets } from './assets.js';
import { Route, WalkGrid } from './route.js';
import { Player } from './player.js';
import { VFX } from './vfx.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { Pickups } from './pickups.js';
import { TRexBoss } from './boss.js';
import { Director, BOSS_TIME } from './director.js';
import { GameAudio } from './audio.js';
import { GameCamera } from './camera.js';
import { HUD, fmtTime } from './hud.js';
import { Input } from './input.js';
import { rollChoices } from './upgrades.js';
import { iconSVG } from './icons.js';

// js/game/game.js
// EXTINCTION AVENUE — entry point and game state machine.
//
//   loading → title (attract: raptors circling the parked cab) → intro (camera swoop) → playing ⇄ levelup / paused
//           → bossintro (GRIDLOCK reveal) → playing → results (victory / defeat) → [endless] / title
//
// URL parameters (handy for testing and clips): ?quality=high|medium|low  ?webgl (force WebGL2)
//   ?boss (start 12 s before GRIDLOCK with a mid-game build)  ?t=SECONDS (start later in the run)  ?nointro
//   ?god (invulnerable, for testing)  ?test (no animation loop: drive the game from window.__game.step()/render(), used by the headless test)

const params = new URLSearchParams(location.search);
const START_S = 120; // 5th Ave, a few blocks south of 57th St, heading downtown
const GAME_URL = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}` : 'https://github.com/mrdoob/slop-newyork';
const TIPS = [
  'Hit GRIDLOCK\'s glowing containment collar for weak-point crits.',
  'Ram small dinosaurs at speed — they fly. Nitro makes rams hit harder.',
  'Max a weapon and own its partner passive to EVOLVE it.',
  'Stomp rings are huge. Hit NITRO to outrun them.',
  'Red lanes mean something heavy is coming down them. Steer out.',
  'Elites glow magenta and drop Cretagen supply crates.',
  'Skyhammer charges with every kill. Save it for the swarm — or the Rex.'
];

const SETTINGS_KEY = 'ea-settings';
const BEST_KEY = 'ea-best';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _proj = new THREE.Vector3();

function loadSettings() {
  const def = { shake: 1, numbers: true, autoFire: false, quality: 'high' };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
}

function makeLivery() {
  const door = () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#ffbe14'; x.fillRect(0, 0, 256, 128);
    // hazard band
    x.save(); x.beginPath(); x.rect(0, 96, 256, 32); x.clip();
    for (let i = -2; i < 20; i++) { x.fillStyle = i % 2 ? '#111317' : '#ffbe14'; x.beginPath(); x.moveTo(i * 18, 128); x.lineTo(i * 18 + 18, 96); x.lineTo(i * 18 + 36, 96); x.lineTo(i * 18 + 18, 128); x.fill(); }
    x.restore();
    x.fillStyle = '#111317';
    x.beginPath(); x.arc(52, 50, 38, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffbe14'; x.font = '900 36px Inter, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('77', 52, 52);
    x.fillStyle = '#111317'; x.textAlign = 'left';
    x.font = '900 22px Inter, Arial, sans-serif'; x.fillText('ANIMAL', 104, 30);
    x.fillText('CONTROL', 104, 54);
    x.font = '700 12px Inter, Arial, sans-serif'; x.fillText('DINO RESPONSE UNIT', 104, 78);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const plate = () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#c3240f'; x.fillRect(6, 6, 244, 24);
    x.fillStyle = '#fff'; x.font = '800 15px Inter, Arial, sans-serif'; x.textAlign = 'center'; x.fillText('EMERGENCY', 128, 23);
    x.fillStyle = '#14161a'; x.font = '900 52px JetBrains Mono, monospace'; x.fillText('DINO 77', 128, 84);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  return { door, plate };
}

class Game {
  constructor() {
    this.state = 'loading';
    this.settings = loadSettings();
    this.testMode = params.has('test');
    this.timeScale = 1;
    this.slow = null; // { scale, t } (real seconds)
    this.hitStopT = 0;
    this.elapsed = 0;
    this.realTime = 0;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
  }

  async init() {
    const status = document.getElementById('load-status');
    const fill = document.getElementById('load-fill');
    const tip = document.getElementById('load-tip');
    tip.textContent = `TIP — ${TIPS[(Math.random() * TIPS.length) | 0]}`;
    const setStatus = (text, p) => {
      if (text) status.textContent = text;
      if (p !== null && p !== undefined) fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, p))})`;
    };
    if (!navigator.gpu && !params.has('webgl')) setStatus('WebGPU unavailable — using WebGL2 fallback…', 0.05);

    this.cam = new GameCamera();
    this.cam.shakeScale = this.settings.shake;
    const quality = params.get('quality') || this.settings.quality;
    let stage = 0.05;
    this.world = await createWorld(document.getElementById('canvas-container'), this.cam.camera, {
      quality, forceWebGL: params.has('webgl'),
      onStatus: (t) => { stage = Math.min(0.45, stage + 0.08); setStatus(t, stage); }
    });
    const scene = this.world.scene;
    setStatus('Thawing specimens…', 0.5);
    this.assets = await loadAssets(ASSET_MANIFEST);
    this.route = new Route();
    this.walk = new WalkGrid(this.route);
    this.player = new Player(scene, this.assets, this.route, makeLivery());
    this.vfx = new VFX(scene, this.assets);
    this.vfx.showNumbers = this.settings.numbers;
    this.audio = new GameAudio();
    this.hud = new HUD(this);
    this.enemies = new EnemyManager(this, this.assets);
    scene.add(this.enemies.group);
    this.weapons = new WeaponSystem(this, this.assets);
    scene.add(this.weapons.group);
    this.pickups = new Pickups(this, this.assets);
    for (const m of this.pickups.meshes()) scene.add(m);
    this.boss = new TRexBoss(this, this.assets);
    for (const m of this.boss.meshes()) scene.add(m);
    this.director = new Director(this);
    this.input = new Input(this);
    this.input.onAction = (a) => this.onAction(a);
    this.stats = this._freshStats();
    this._bindUI();

    // Title scene, then compile every pipeline behind the loading screen (with one instance in every batch/rig)
    this.setupTitle();
    this.cam.update(0.016, this.player);
    const batches = [];
    scene.traverse((o) => { if (o.isInstancedMesh && o.count === 0 && o.name && !o.name.startsWith('Manhattan')) batches.push(o); });
    for (const m of batches) m.count = 1;
    setStatus('Compiling shaders…', 0.55);
    await this.world.compile((p) => setStatus(`Compiling shaders… ${Math.round(p * 100)}%`, 0.55 + p * 0.4));
    this.world.warmup();
    for (const m of batches) m.count = 0;
    setStatus('Ready', 1);
    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    this.lastNow = performance.now();
    if (!this.testMode) {
      this.world.renderer.setAnimationLoop((now) => this.frame(now));
    }
    const device = this.world.renderer.backend.device;
    await Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {});
    this.setState('title');
    if (params.has('boss') || params.has('t') || params.has('autostart')) this.startRun();
  }

  _freshStats() {
    return { kills: 0, damageDealt: 0, damageTaken: 0, roadkill: 0, byType: {}, elites: 0, bossKilled: false, bossKillTime: 0 };
  }

  setState(s) {
    this.state = s;
    document.body.className = document.body.className.replace(/\bs-\S+/g, '').trim() + ` s-${s}`;
    if (this.input?.touchMode) document.body.classList.add('touch');
  }

  // ------------------------------------------------------------------------------------------------------------------
  _bindUI() {
    const $ = (id) => document.getElementById(id);
    const click = (id, fn) => $(id)?.addEventListener('click', () => { this.audio.unlock(); this.audio.play('ui'); fn(); });
    click('btn-play', () => this.startRun());
    click('btn-howto', () => this.hud.open('s-howto'));
    click('btn-settings', () => this.openSettings());
    click('btn-pause-settings', () => this.openSettings());
    click('btn-resume', () => this.togglePause(false));
    click('btn-quit', () => { this.togglePause(false); this.endRun(false, true); });
    click('btn-again', () => { this.hud.open('s-results', false); this.startRun(); });
    click('btn-menu', () => { this.hud.open('s-results', false); this.setupTitle(); this.setState('title'); });
    click('btn-endless', () => this.continueEndless());
    click('btn-share', () => this.share());
    click('lu-reroll', () => this.reroll());
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { this.audio.play('ui'); b.closest('.screen').classList.remove('open'); });
    for (const b of document.querySelectorAll('.btn')) b.addEventListener('pointerenter', () => this.audio.play('ui_hover'));
    // Settings
    const s = this.settings;
    const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
    $('set-sound').checked = this.audio.enabled;
    $('set-music').value = this.audio.volume.music;
    $('set-sfx').value = this.audio.volume.sfx;
    $('set-shake').value = String(s.shake);
    $('set-numbers').checked = s.numbers;
    $('set-autofire').checked = s.autoFire;
    $('set-quality').value = s.quality;
    $('set-sound').addEventListener('change', (e) => { this.audio.unlock(); this.audio.setEnabled(e.target.checked); });
    $('set-music').addEventListener('input', (e) => { this.audio.volume.music = +e.target.value; this.audio.applyVolumes(); });
    $('set-sfx').addEventListener('input', (e) => { this.audio.volume.sfx = +e.target.value; this.audio.applyVolumes(); this.audio.play('gun'); });
    $('set-shake').addEventListener('change', (e) => { s.shake = +e.target.value; this.cam.shakeScale = s.shake; save(); });
    $('set-numbers').addEventListener('change', (e) => { s.numbers = e.target.checked; this.vfx.showNumbers = s.numbers; save(); });
    $('set-autofire').addEventListener('change', (e) => { s.autoFire = e.target.checked; save(); });
    $('set-quality').addEventListener('change', (e) => { s.quality = e.target.value; save(); $('set-note').textContent = 'Graphics quality applies after a reload.'; });
    // Unlock audio on the first gesture anywhere
    const unlock = () => { this.audio.unlock(); if (this.state === 'title') this.audio.setMusic('title'); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    const best = this._best();
    if (best.score) document.getElementById('best').innerHTML = `Best shift: <b>${best.score.toLocaleString('en-US')}</b> · ${fmtTime(best.time)}${best.boss ? ' · Apex down' : ''}`;
  }

  openSettings() {
    this.hud.open('s-settings');
  }

  onAction(a) {
    const st = this.state;
    if (a === 'mute') { this.audio.setEnabled(!this.audio.enabled); document.getElementById('set-sound').checked = this.audio.enabled; return; }
    if (a === 'autofire') { this.settings.autoFire = !this.settings.autoFire; document.getElementById('set-autofire').checked = this.settings.autoFire; this.hud.prompt(this.settings.autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF', 'nitro'); return; }
    if (st === 'levelup') {
      if (a.startsWith('pick')) { const i = +a.slice(4) - 1; if (i < this.choices.length) this.pick(i); }
      if (a === 'reroll') this.reroll();
      return;
    }
    if (a === 'pause' && (st === 'playing' || st === 'paused')) { this.togglePause(st === 'playing'); return; }
    if (st === 'title' && a === 'confirm') { this.audio.unlock(); this.startRun(); return; }
    if (st === 'playing' && a === 'special') {
      if (!this.weapons.triggerSpecial() && this.weapons.special.charge < 1) this.hud.prompt('SKYHAMMER CHARGING', 'nitro');
    }
  }

  togglePause(on) {
    if (on) {
      this.setState('paused');
      document.getElementById('pause-build').innerHTML = this.weapons.buildList().map((b) => this.hud.slotHTML(b)).join('');
      this.hud.open('s-pause', true);
      this.audio.setMuffled(true);
    } else {
      this.hud.open('s-pause', false);
      this.hud.open('s-settings', false);
      this.setState('playing');
      this.audio.setMuffled(false);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  _resetRun() {
    this.enemies.clear();
    this.pickups.clear();
    this.vfx.clear();
    this.boss.reset();
    this.weapons.reset();
    this.player.reset(START_S);
    this.player.stats.nitroRegen = 1;
    this.weapons.recomputeStats();
    this.score = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeed = this._need(1);
    this.pendingLevels = 0;
    this.pendingCrates = 0;
    this.rerolls = 3;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.stats = this._freshStats();
    this.minibosses = [];
    this.hud.hideBoss();
    this.hud.bannerQueue.length = 0;
    this.victory = false;
    this.slow = null;
    this.timeScale = 1;
    this.hintStep = 0;
    this.hintT = 0;
  }

  setupTitle() {
    this._resetRun();
    this.director.reset(0);
    this.player.update(0.016, { steer: 0, boost: false, brake: true }, 0);
    this.player.speed = 0;
    this.cam.orbit(this.player, 15, 5.2, 0.12, 0.6, 46);
    this.cam.orbitState.lookY = 1.2;
    this.cam.snap = true;
    // A pack prowling around the cab
    const p = this.player;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 16;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (!this.walk.isBlocked(x, z)) this.enemies.spawn(i < 8 ? 'raptor' : 'compy', x, z, { heading: a + Math.PI });
    }
    this.enemies.spawn('brute', p.x + p.fx * 18, p.z + p.fz * 18, { heading: p.heading + Math.PI, elite: true });
    this.enemies.spawn('trike', p.x - p.fx * 28 + 4, p.z - p.fz * 28, { heading: p.heading });
    this.enemies.spawn('ankylo', p.x + p.fx * 40, p.z + p.fz * 40, { heading: p.heading });
    this.enemies.spawn('ptero', p.x + 10, p.z + 6, {});
    this.enemies.spawn('ptero', p.x - 12, p.z - 8, {});
    this.audio.setMusic('title');
  }

  startRun() {
    this.audio.unlock();
    this._resetRun();
    this.setState('intro');
    const start = params.has('boss') ? BOSS_TIME - 12 : Math.max(0, +(params.get('t') || 0));
    this.director.reset(start);
    if (start > 0) this._grantBuild(start);
    this.audio.setMusic('run');
    const p = this.player;
    p.update(0.016, { steer: 0, boost: false, brake: false }, 0);
    if (params.has('nointro') || this.testMode) {
      this._beginPlay();
      this.cam.setMode('chase', true);
      return;
    }
    document.body.classList.add('cine');
    p.autoDrive = true;
    const air = new THREE.Vector3(), side = new THREE.Vector3(), look = new THREE.Vector3(), look2 = new THREE.Vector3(), chase = new THREE.Vector3(), chaseLook = new THREE.Vector3();
    this.cam.playCinematic([
      { t: 0, pos: () => air.set(p.x + p.fx * 90 - p.rx * 30, 85, p.z + p.fz * 90 - p.rz * 30), look: () => look.set(p.x, 0, p.z), fov: 55 },
      { t: 1.6, pos: () => side.set(p.x + p.fx * 9 + Math.cos(p.heading) * 6, 1.4, p.z + p.fz * 9 - Math.sin(p.heading) * 6), look: () => look2.set(p.x, 1, p.z), fov: 44 },
      { t: 3.0, pos: () => chase.set(p.x - p.fx * 13, 7.6, p.z - p.fz * 13), look: () => chaseLook.set(p.x + p.fx * 16, 0.6, p.z + p.fz * 16), fov: 60 }
    ], () => {
      document.body.classList.remove('cine');
      p.autoDrive = false;
      this.cam.setMode('chase');
      this._beginPlay();
    });
    this.hud.banner('MIDTOWN · 7:14 PM', 'Unit 77 — contain the outbreak', 'wave', true);
  }

  _beginPlay() {
    this.setState('playing');
    this.hud.banner('GO!', '', 'good', true);
    this.audio.play('bell');
    this.hintStep = 0;
    this.hintT = 1.5;
  }

  /** Debug/test: a plausible build for starting mid-run */
  _grantBuild(t) {
    const picks = [['weapon', 'gatling'], ['weapon', 'gatling'], ['weapon', 'missiles'], ['weapon', 'saws'], ['passive', 'hollow'], ['weapon', 'cannon'], ['weapon', 'tesla'],
      ['weapon', 'gatling'], ['passive', 'loader'], ['weapon', 'missiles'], ['weapon', 'cannon'], ['passive', 'chassis'], ['weapon', 'saws'], ['weapon', 'gatling'], ['weapon', 'gatling'],
      ['passive', 'magnet'], ['weapon', 'tesla'], ['weapon', 'missiles'], ['weapon', 'cannon'], ['weapon', 'cannon'], ['evolution', 'storm_gatling']];
    const n = Math.min(picks.length, Math.round(t / 22));
    for (let i = 0; i < n; i++) this.weapons.apply({ kind: picks[i][0], id: picks[i][1] });
    this.level = n + 1;
    this.xpNeed = this._need(this.level);
    this.player.hp = this.player.maxHp;
    this.weapons.special.charge = 1;
  }

  continueEndless() {
    this.hud.open('s-results', false);
    this.director.endless = true;
    this.director.bossDone = true;
    this.director.bossActive = false;
    this.player.hp = this.player.maxHp;
    this.audio.setMusic('run');
    this.setState('playing');
    this.cam.setMode('chase');
    this.hud.banner('ENDLESS', 'Manhattan never sleeps', 'wave', true);
  }

  // ------------------------------------------------------------------------------------------------------------------
  frame(now) {
    const rawDt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    this.tick(Math.min(0.05, Math.max(0.0005, rawDt)));
    this.renderFrame();
  }

  tick(dt) {
    this.realTime += dt;
    this.input.update(dt);
    // Slow motion & hit-stop operate on game time only; camera and UI run in real time
    if (this.slow) {
      this.slow.t -= dt;
      this.timeScale += (this.slow.scale - this.timeScale) * Math.min(1, dt * 10);
      if (this.slow.t <= 0) this.slow = null;
    } else this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 4);
    let sim = dt * this.timeScale;
    if (this.hitStopT > 0) { this.hitStopT -= dt; sim *= 0.05; }
    const st = this.state;
    const simulating = st === 'playing' || st === 'intro' || st === 'bossintro' || st === 'title' || st === 'dead';
    if (simulating) this.simulate(sim, dt);
    else this.vfx.update(0); // keeps telegraph batches stable while paused
    this.cam.update(dt, this.player);
    this.world.post.uniforms.hurt.value = Math.max(this.player.hurtFlash * 0.5, this.player.alive && this.player.hp / this.player.maxHp < 0.25 ? 0.3 + 0.2 * Math.sin(this.realTime * 6) : 0);
    this.world.post.uniforms.aberration.value *= Math.max(0, 1 - dt * 4);
    this.world.post.uniforms.desat.value += ((st === 'levelup' || st === 'paused' ? 0.8 : this.timeScale < 0.6 ? 0.45 : 0) - this.world.post.uniforms.desat.value) * Math.min(1, dt * 6);
    this.world.post.uniforms.flash.value *= Math.max(0, 1 - dt * 3);
    this.world.post.uniforms.danger.value = this.boss.active ? 0.35 : 0;
    const c = this.cam.camera;
    c.getWorldDirection(_v);
    this.audio.setListener(c.position.x, c.position.z, _v.x, _v.z);
    this.audio.updateLoops(this.player.speed, this.player.boosting, this.weapons.flaming, simulating && st !== 'title' && this.player.alive);
    if (st !== 'loading' && st !== 'title') this.hud.update(dt);
    // Queued level-ups open as soon as the action allows
    if (this.state === 'playing' && (this.pendingLevels > 0 || this.pendingCrates > 0) && this.player.alive && this.cam.mode !== 'cinematic') this.openLevelUp();
    this._hints(dt);
  }

  simulate(dt, realDt) {
    const st = this.state;
    const p = this.player;
    this.elapsed += dt;
    this.vfx.beginTelegraphs();
    this.vfx.threats.length = 0;
    const playing = st === 'playing' || st === 'bossintro' || st === 'dead';
    if (st === 'playing') this.director.update(dt);
    // Controls
    const rev = this.cam.reverseAmt > 0.5 ? -1 : 1;
    const ctl = st === 'playing'
      ? { steer: this.input.steer * rev, boost: this.input.boost, brake: this.input.brake }
      : { steer: 0, boost: false, brake: false };
    if (st === 'playing' && ctl.boost && !p.wasBoosting && p.nitro > 0.1) this.audio.play('nitro', { volume: 0.6 });
    p.wasBoosting = p.boosting;
    const cruise = st === 'title' ? 0 : this.director.cruise();
    p.update(dt, ctl, cruise);
    if (p.stats.nitroRegen > 1 && !p.boosting) p.nitro = Math.min(1, p.nitro + dt * 0.075 * (p.stats.nitroRegen - 1));
    if (p.boosting) this.vfx.speedLines = Math.min(1, this.vfx.speedLines + dt * 4); else this.vfx.speedLines = Math.max(0, this.vfx.speedLines - dt * 3);
    if (p.edgeScrape > 4) { this.vfx.sparks(p.x + (p.d > 0 ? -1 : 1) * -1, 0.4, p.z, 3, 6); }
    // Aim + weapons
    if (playing && p.alive) {
      this._updateAim();
      this.weapons.update(dt, { fire: this.input.fire && st === 'playing', autoFire: (this.settings.autoFire || this.input.touchMode) && st === 'playing' });
    } else if (st === 'title') {
      this.weapons.sawBatch.begin(); this.weapons.sawBatch.end();
    }
    if (!playing && st !== 'title') this.weapons._updateProjectiles(dt);
    this.enemies.update(dt);
    this.boss.update(dt);
    this.pickups.update(dt);
    // Combo decay
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.vfx.endTelegraphs();
    this.vfx.update(dt);
    // Mini-boss bars
    if (this.minibosses.length && !this.boss.active) {
      const mb = this.minibosses[0];
      if (!mb.alive || mb.hp <= 0) this.minibosses.shift();
    }
    // Dead: after the slow-mo wreck, the report
    if (st === 'dead') {
      this.deadT -= realDt;
      if (Math.random() < 0.3) this.vfx.smoke.spawn(p.x, 1, p.z, (Math.random() - 0.5), 3, (Math.random() - 0.5), 1.6, 0.8, 3, 0.08, 0.08, 0.08, { drag: 1 });
      if (Math.random() < 0.2) this.vfx.glow.spawn(p.x + (Math.random() - 0.5) * 2, 0.8, p.z + (Math.random() - 0.5) * 2, 0, 3, 0, 0.5, 0.8, 1.4, 7, 2.2, 0.4, { r1: 1, g1: 0.1, b1: 0 });
      if (this.deadT <= 0) this.endRun(false);
    }
    if (this.victoryT !== undefined && this.victoryT > 0) {
      this.victoryT -= realDt;
      if (this.victoryT <= 0) this.endRun(true);
    }
  }

  renderFrame() {
    this.enemies.render(this.elapsed);
    this.world.update(this.cam.camera, this.elapsed);
    this.world.render();
    this.vfx.drawOverlay(this.cam.camera);
  }

  // ------------------------------------------------------------------------------------------------------------------
  _updateAim() {
    const cam = this.cam.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const inp = this.input;
    const aim = this.weapons.aim;
    const p = this.player;
    const touchAuto = inp.touchMode && inp.touchAim.id === null;
    const mx = inp.mouse.x, my = inp.mouse.y;
    let best = null, bestD = (inp.touchMode ? 110 : 64) ** 2, weak = false, bx = 0, by = 0;
    const consider = (e, x, y, z, isWeak, bonus = 1) => {
      _proj.set(x, y, z).project(cam);
      if (_proj.z > 1 || _proj.z < -1) return;
      const sx = (_proj.x * 0.5 + 0.5) * W, sy = (-_proj.y * 0.5 + 0.5) * H;
      const d = ((sx - mx) ** 2 + (sy - my) ** 2) / bonus;
      if (d < bestD) { bestD = d; best = e; weak = isWeak; bx = sx; by = sy; aim.x = x; aim.y = y; aim.z = z; }
    };
    if (!touchAuto) {
      const be = this.boss.e;
      if (be && this.boss.active && be.state !== 'dying') consider(be, this.boss.collar.x, this.boss.collar.y, this.boss.collar.z, true, 2.2);
      for (const e of this.enemies.list) {
        if (e.state === 'dying' || e.state === 'launched' || e.ghost) continue;
        const dx = e.x - p.x, dz = e.z - p.z;
        if (dx * dx + dz * dz > 130 * 130) continue;
        const h = e.ctrl ? 4.5 * e.scale : e.sp.height * e.scale * 0.55;
        consider(e, e.x, e.y + h, e.z, false);
      }
    } else {
      // Touch / auto-fire with no finger aiming: nearest threat ahead, the boss collar when it's up
      const be = this.boss.e;
      if (be && this.boss.active && be.state !== 'dying') { best = be; weak = true; aim.x = this.boss.collar.x; aim.y = this.boss.collar.y; aim.z = this.boss.collar.z; }
      else {
        const t = this.enemies.nearest(p.x + p.fx * 12, p.z + p.fz * 12, 55);
        if (t) { best = t; aim.x = t.x; aim.y = t.y + t.sp.height * t.scale * 0.55; aim.z = t.z; }
      }
      if (best) {
        _proj.set(aim.x, aim.y, aim.z).project(cam);
        bx = (_proj.x * 0.5 + 0.5) * W; by = (-_proj.y * 0.5 + 0.5) * H;
      }
    }
    if (best) {
      // Lead moving targets for the cannon's travel time
      if (!weak) {
        const d = Math.hypot(aim.x - p.x, aim.z - p.z);
        aim.x += best.vx * d / 150;
        aim.z += best.vz * d / 150;
      }
    } else {
      const ndcX = (mx / W) * 2 - 1, ndcY = -(my / H) * 2 + 1;
      this.cam.aimPoint(ndcX, ndcY, 0.9, _v2);
      const dx = _v2.x - p.x, dz = _v2.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 140) { _v2.x = p.x + dx / d * 140; _v2.z = p.z + dz / d * 140; }
      aim.x = _v2.x; aim.y = 0.9; aim.z = _v2.z;
    }
    aim.target = best;
    aim.weak = weak;
    const s = best ? Math.max(0.6, Math.min(2.4, (best.radius * 3) / Math.max(4, Math.hypot(best.x - cam.position.x, best.z - cam.position.z)) * 6)) : 1;
    this.hud.reticle(mx, my, inp.fire, best ? { x: bx, y: by, s: weak ? 1.2 : s, weak } : null);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Hooks called by the systems
  hurtPlayer(dmg, x, z, kind) {
    const p = this.player;
    if (this.state !== 'playing' || !p.alive || params.has('god')) return 0;
    const dealt = p.hurt(dmg);
    if (!dealt) return 0;
    this.stats.damageTaken += dealt;
    this.cam.addTrauma(Math.min(0.55, 0.18 + dealt * 0.012));
    this.world.post.uniforms.aberration.value = Math.min(1, 0.3 + dealt * 0.03);
    this.vfx.number(p.x, 2.4, p.z, `-${Math.round(dealt)}`, 2);
    this.vfx.sparks(p.x + (x - p.x) * 0.3, 1, p.z + (z - p.z) * 0.3, 10, 9);
    this.audio.play('hurt', { volume: 0.8, pitch: 0.9 + Math.random() * 0.2 });
    this.hud.hurt();
    if (this.combo >= 10) this.combo = Math.floor(this.combo / 2);
    if (!p.alive) this.onPlayerDeath();
    void kind;
    return dealt;
  }

  onRam(e, speed) {
    this.audio.play('ram', { x: e.x, z: e.z, volume: Math.min(1, 0.3 + speed * 0.03) });
    this.vfx.sparks(e.x, 0.8, e.z, 5, 8);
    if (e.sp.mass > 2) { this.cam.addTrauma(0.2); this.hitStop(0.04); }
    else this.cam.addTrauma(0.05);
  }

  onCannonHit(e, weak) {
    this.hud.hitmark();
    if (weak) this.vfx.sparks(this.boss.collar.x, this.boss.collar.y, this.boss.collar.z, 4, 6, 1.5, 5, 7);
  }

  onEnemyKilled(e, cause) {
    if (e.ghost) return;
    const st = this.stats;
    st.kills++;
    st.byType[e.type] = (st.byType[e.type] || 0) + 1;
    if (cause === 'ram') st.roadkill++;
    if (e.elite) st.elites++;
    if (e.boss) { this.onBossKilled(e); return; }
    this.combo++;
    this.comboT = 2.5;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    const callouts = { 50: 'RAMPAGE', 100: 'MASS EXTINCTION', 200: 'METEOR STRIKE', 400: 'K-PG BOUNDARY' };
    if (callouts[this.combo]) { this.hud.banner(callouts[this.combo], `${this.combo} kill combo · x${this.comboMult()}`, 'combo', true); this.audio.play('combo', { pitch: 1 + this.combo / 400 }); }
    const sc = e.sp.score * (e.elite ? 5 : 1) * (e.miniboss ? 10 : 1);
    this.addScore(sc * this.comboMult());
    this.weapons.addCharge((e.elite ? 0.12 : 0.0045) * (e.sp.mass > 3 ? 3 : 1));
    if (e.sp.mass * e.scale > 3) this.hitStop(e.elite ? 0.08 : 0.035);
    if (e.miniboss) {
      this.hud.banner('MINI-BOSS DOWN', e.name, 'good', true);
      this.flash(0.25);
      this.cam.addTrauma(0.5);
    }
  }

  dropLoot(e) {
    const xp = e.sp.xp * (e.elite ? 5 : 1) * (e.miniboss ? 4 : 1);
    if (xp > 0) {
      const n = xp >= 40 ? 4 : xp >= 15 ? 2 : 1;
      for (let i = 0; i < n; i++) this.pickups.gem(e.x, e.z, xp / n);
    }
    if (e.dropCrate) this.pickups.spawnItem('crate', e.x, e.z);
    const big = e.sp.mass > 3 ? 4 : 1;
    const r = Math.random();
    if (r < 0.007 * big) this.pickups.spawnItem('repair', e.x, e.z);
    else if (r < 0.012 * big) this.pickups.spawnItem('nitro', e.x, e.z);
    else if (r < 0.0145 * big) this.pickups.spawnItem('vacuum', e.x, e.z);
    else if (r < 0.0165 * big) this.pickups.spawnItem('airstrike', e.x, e.z);
  }

  collectItem(type, x, z) {
    const p = this.player;
    switch (type) {
      case 'crate':
        this.pendingCrates++;
        this.audio.play('crate');
        this.hud.banner('SUPPLY DROP', 'Cretagen crate secured', 'good');
        break;
      case 'repair':
        p.heal(p.maxHp * 0.35);
        this.vfx.number(p.x, 2.4, p.z, `+${Math.round(p.maxHp * 0.35)} HULL`, 3);
        this.audio.play('heal');
        break;
      case 'nitro':
        p.nitro = 1;
        this.vfx.number(p.x, 2.4, p.z, 'NITRO FULL', 4);
        this.audio.play('nitro');
        break;
      case 'vacuum':
        this.pickups.vacuum();
        this.vfx.number(p.x, 2.4, p.z, 'GENE MAGNET', 4);
        this.audio.play('levelup');
        break;
      case 'airstrike':
        this.weapons.special.charge = 1;
        this.hud.banner('SKYHAMMER READY', 'Press SPACE to call it in', 'special');
        this.audio.play('crate');
        break;
    }
    this.vfx.shockwave(x, z, 4, 1, 3, 3, 0.4);
  }

  addScore(v, label = null) {
    this.score += Math.round(v);
    if (label) this.vfx.number(this.player.x, 3, this.player.z, `+${Math.round(v)} ${label}`, 4);
  }

  comboMult() {
    const c = this.combo;
    return c >= 200 ? 8 : c >= 100 ? 5 : c >= 50 ? 4 : c >= 25 ? 3 : c >= 10 ? 2 : 1;
  }

  _need(level) {
    return Math.round(10 + level * 9 + level * level * 1.5);
  }

  addXP(v) {
    if (this.state === 'title') return;
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = this._need(this.level);
      this.pendingLevels++;
      this.hud.el.xpWrap.classList.remove('pulse'); void this.hud.el.xpWrap.offsetWidth; this.hud.el.xpWrap.classList.add('pulse');
    }
  }

  trackMiniboss(e) {
    this.minibosses.push(e);
    if (!this.boss.active) this.hud.showBoss(e, e.name, 'Mini-boss', true);
  }

  hitStop(t) {
    this.hitStopT = Math.max(this.hitStopT, t);
  }

  flash(a) {
    this.world.post.uniforms.flash.value = Math.max(this.world.post.uniforms.flash.value, a);
  }

  slowmo(scale, t) {
    this.slow = { scale, t };
  }

  // ------------------------------------------------------------------------------------------------------------------
  openLevelUp() {
    const crate = this.pendingCrates > 0;
    this.choices = rollChoices({ weapons: this.weapons.weapons, passives: this.weapons.passives, evolved: this.weapons.evolved, level: this.level }, crate ? 4 : 3);
    this.choiceCrate = crate;
    this.setState('levelup');
    this.audio.play(this.choices[0]?.kind === 'evolution' ? 'evolve' : 'levelup');
    this.audio.setMuffled(true);
    this._showChoices();
  }

  _showChoices() {
    const crate = this.choiceCrate;
    this.hud.showLevelUp(this.choices, { weapons: this.weapons.weapons, passives: this.weapons.passives, evolved: this.weapons.evolved, level: this.level }, {
      kicker: crate ? 'CRETAGEN SUPPLY DROP' : `LEVEL ${this.level - this.pendingLevels + 1}`,
      title: this.choices.some((c) => c.kind === 'evolution') ? 'EVOLUTION AVAILABLE' : crate ? 'PICK YOUR LOOT' : 'CHOOSE AN UPGRADE',
      crate, rerolls: this.rerolls
    }, (i) => this.pick(i));
  }

  reroll() {
    if (this.state !== 'levelup' || this.rerolls <= 0) return;
    this.rerolls--;
    this.choices = rollChoices({ weapons: this.weapons.weapons, passives: this.weapons.passives, evolved: this.weapons.evolved, level: this.level }, this.choiceCrate ? 4 : 3);
    this.audio.play('ui');
    this._showChoices();
  }

  pick(i) {
    if (this.state !== 'levelup') return;
    const c = this.choices[i];
    if (!c) return;
    if (c.kind === 'bonus') {
      if (c.id === 'repair') this.player.heal(this.player.maxHp * 0.4);
      else this.addScore(5000);
    } else this.weapons.apply(c);
    if (c.kind === 'evolution') {
      this.audio.play('evolve');
      this.hud.banner('EVOLVED', `${(c.id === 'railgun' ? 'Rail Lance' : this.weapons.buildList().find((b) => b.id === c.id)?.name) || ''}`, 'combo', true);
      this.flash(0.35);
    } else this.audio.play('ui', { pitch: 1.3 });
    if (this.choiceCrate) this.pendingCrates--; else this.pendingLevels--;
    this.hud.hideLevelUp();
    this.audio.setMuffled(false);
    this.setState('playing');
    // A breath of slow motion before the action resumes
    this.timeScale = 0.2;
  }

  // ------------------------------------------------------------------------------------------------------------------
  startBoss() {
    this.boss.start();
  }

  bossIntro(e) {
    this.setState('bossintro');
    this.vfx.showNumbers = false;
    document.body.classList.add('cine');
    this.slowmo(0.3, 3.4);
    for (const mb of this.minibosses) void mb;
    const p = this.player;
    const boss = this.boss;
    const a = this.cam.pos.clone(), al = this.cam.look.clone();
    const k1 = new THREE.Vector3(), k2 = new THREE.Vector3(), head = new THREE.Vector3(), rp = new THREE.Vector3(), rl = new THREE.Vector3();
    const fwd = () => [Math.sin(e.heading), Math.cos(e.heading)];
    this.cam.playCinematic([
      { t: 0, pos: a, look: al, fov: 58 },
      { t: 0.5, pos: () => { const [fx, fz] = fwd(); return k1.set(e.rx + fx * 26 + fz * 9, 3.2, e.rz + fz * 26 - fx * 9); }, look: () => head.copy(boss.headPos).setY(boss.headPos.y * 0.75), fov: 40 },
      { t: 2.9, pos: () => { const [fx, fz] = fwd(); return k2.set(e.rx + fx * 20 + fz * 6, 2.6, e.rz + fz * 20 - fx * 6); }, look: () => head.copy(boss.headPos).setY(boss.headPos.y * 0.8), fov: 33 },
      { t: 3.6, pos: () => rp.set(p.x + p.fx * 10.5, 4.6, p.z + p.fz * 10.5), look: () => rl.set(p.x - p.fx * 16, 2.6, p.z - p.fz * 16), fov: 56 }
    ], () => {
      document.body.classList.remove('cine');
      this.cam.reverseAmt = 1;
      this.cam.setMode('reverse');
      this.setState('playing');
      this.vfx.showNumbers = this.settings.numbers;
      this.hud.prompt('AIM FOR THE COLLAR!', '');
    });
    setTimeout(() => this.hud.nameCard('CRETAGEN APEX SPECIMEN T-01', 'GRIDLOCK', 'Tyrannosaurus rex · 9.6 m · Containment: FAILED'), this.testMode ? 0 : 500);
    this.hud.showBoss(e, 'GRIDLOCK', 'Cretagen Apex Specimen T-01 · Tyrannosaurus rex', false);
  }

  onBossKilled(e) {
    this.hitStop(0.18);
    this.slowmo(0.45, 2.4);
    this.stats.bossKilled = true;
    this.stats.bossKillTime = this.director.time - BOSS_TIME;
    this.flash(0.5);
    this.audio.play('trex_roar', { volume: 1.2, pitch: 0.7, dur: 2.6 });
    const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
    this.cam.orbit({ get x() { return e.rx + fx * 3; }, get z() { return e.rz + fz * 3; }, y: 0 }, 25, 12, 0.3, e.heading + 0.9, 50);
    this.cam.orbitState.lookY = 3;
    this.vfx.showNumbers = false;
    this.hud.banner('APEX DOWN', 'GRIDLOCK is going extinct', 'boss', true);
    // Clear the small fry for the money shot
    for (const o of this.enemies.list) if (!o.boss && Math.hypot(o.x - e.x, o.z - e.z) < 40) this.enemies.kill(o, 'boss', { launch: true, vy: 8 });
  }

  onBossDefeated() {
    this.director.bossActive = false;
    this.director.bossDone = true;
    this.addScore(50000);
    this.vfx.number(this.player.x, 4, this.player.z, '+50,000 APEX BONUS', 4);
    this.audio.play('victory');
    this.audio.setMusic('results');
    this.victoryT = 4;
  }

  onPlayerDeath() {
    const p = this.player;
    this.setState('dead');
    this.deadT = 2.8;
    this.slowmo(0.3, 2.2);
    this.hitStop(0.15);
    this.vfx.explosion(p.x, 1, p.z, 3, 0);
    this.audio.play('death');
    this.cam.addTrauma(1);
    this.flash(0.4);
    this.cam.orbit({ x: p.x, z: p.z, y: 0 }, 16, 6, 0.4, p.heading + 2.4, 50);
    this.hud.banner('UNIT 77 DOWN', 'The city belongs to them now', 'boss', true);
  }

  endRun(win, quit = false) {
    if (this.state === 'results') return;
    this.victoryT = undefined;
    const best = this._best();
    const time = this.director.time;
    const r = {
      win, score: this.score, time, kills: this.stats.kills, level: this.level, maxCombo: this.maxCombo, roadkill: this.stats.roadkill,
      boss: this.stats.bossKilled, bossTime: this.stats.bossKillTime, build: this.weapons.buildList(), endless: this.director.endless,
      title: win ? 'CITY SAVED' : quit ? 'OFF DUTY' : 'FOSSILIZED',
      sub: win ? `GRIDLOCK fossilized in ${fmtTime(this.stats.bossKillTime)} · ${this.stats.kills.toLocaleString('en-US')} dinosaurs down` : `Unit 77 held Midtown for ${fmtTime(time)}`,
      best: best.score, newBest: this.score > (best.score || 0)
    };
    if (r.newBest) {
      try { localStorage.setItem(BEST_KEY, JSON.stringify({ score: this.score, time, boss: this.stats.bossKilled })); } catch { /* ignore */ }
      document.getElementById('best').innerHTML = `Best shift: <b>${this.score.toLocaleString('en-US')}</b> · ${fmtTime(time)}${this.stats.bossKilled ? ' · Apex down' : ''}`;
    }
    this.lastResult = r;
    this.vfx.showNumbers = this.settings.numbers;
    this.setState('results');
    this.audio.setMusic('results');
    this.hud.hideBoss();
    this.hud.showResults(r);
  }

  _best() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; }
  }

  shareText(r = this.lastResult) {
    const weapons = r.build.filter((b) => b.kind === 'weapon').map((b) => b.name).slice(0, 3).join(' + ');
    const head = r.win
      ? `I put down GRIDLOCK the T. rex in ${fmtTime(r.bossTime)} 🦖💥`
      : `My armored cab survived ${fmtTime(r.time)} of the Manhattan dinosaur outbreak 🦖🚕`;
    return `${head}\n${r.score.toLocaleString('en-US')} pts · ${r.kills.toLocaleString('en-US')} dinos fossilized · ${r.maxCombo}x combo\nBuild: ${weapons}\nCan you beat it? #ExtinctionAvenue`;
  }

  shareURL(r = this.lastResult) {
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(this.shareText(r))}&url=${encodeURIComponent(GAME_URL)}`;
  }

  share() {
    window.open(this.shareURL(), '_blank', 'noopener,noreferrer,width=600,height=520');
  }

  // ------------------------------------------------------------------------------------------------------------------
  _hints(dt) {
    if (this.state !== 'playing' || this.director.time > 40) { if (this.hintStep < 99 && this.hintStep > 0) { this.hud.hint(null, false); this.hintStep = 99; } return; }
    this.hintT -= dt;
    if (this.hintT > 0) return;
    const touch = this.input.touchMode;
    const steps = touch
      ? ['Left thumb: <b>STEER</b> · cannon auto-fires', 'Tap the street to <b>AIM</b>', '<b>NITRO</b> button to boost & ram']
      : [`${iconSVG('mouse')} <b>AIM</b> + <b>HOLD LEFT CLICK</b> to fire`, '<kbd>A</kbd><kbd>D</kbd> <b>STEER</b> — ram the small ones', '<kbd>SHIFT</kbd> <b>NITRO</b> · <kbd>SPACE</kbd> <b>SKYHAMMER</b>'];
    if (this.hintStep < steps.length) {
      this.hud.hint(steps[this.hintStep], true);
      this.hintStep++;
      this.hintT = 5;
    } else if (this.hintStep < 99) {
      this.hud.hint(null, false);
      this.hintStep = 99;
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.cam.onResize(w, h);
    this.world.resize(w, h);
    this.vfx.resizeOverlay();
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Test hooks (headless: ?test)
  testAPI() {
    return {
      game: this,
      start: () => this.startRun(),
      step: (seconds, dt = 1 / 30) => { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) this.tick(dt); return this.summary(); },
      render: () => { this.renderFrame(); return true; },
      summary: () => this.summary(),
      pick: (i) => this.pick(i),
      setAim: (x, y) => { this.input.mouse.x = x; this.input.mouse.y = y; },
      fire: (on) => { this.input.mouse.down = on; },
      key: (code, on) => { if (on) this.input.keys.add(code); else this.input.keys.delete(code); }
    };
  }

  summary() {
    return {
      state: this.state, time: +this.director.time.toFixed(1), level: this.level, score: this.score, kills: this.stats.kills,
      enemies: this.enemies.count, hp: Math.round(this.player.hp), boss: this.boss.e ? { mode: this.boss.e.mode, hp: Math.round(this.boss.e.hp), phase: this.boss.e.phase } : null,
      build: this.weapons.buildList().map((b) => `${b.id}:${b.level}`).join(' '), choices: this.choices?.map((c) => `${c.kind}:${c.id}`)
    };
  }
}

const game = new Game();
window.__game = game.testAPI();
game.init().catch((err) => {
  console.error(err);
  const s = document.getElementById('load-status');
  if (s) s.textContent = `Could not start: ${err.message}. Try a recent Chrome, Edge or Safari (WebGPU / WebGL2).`;
});
