import * as THREE from 'three/webgpu';
import { createWorld } from './world.js';
import { ASSET_MANIFEST, loadAssets } from './assets.js';
import { releaseModelCaches } from './skin-model.js';
import { Route, WalkGrid } from './route.js';
import { Player } from './player.js';
import { VFX } from './vfx.js';
import { EnemyManager } from './enemies.js';
import { WeaponSystem } from './weapons.js';
import { Pickups } from './pickups.js';
import { TRexBoss } from './boss.js';
import { Director, BOSS_TIME } from './director.js';
import { STAGES, stageById } from './stages.js';
import { loadProgress, saveProgress, isUnlocked, applyResult } from './campaign.js';
import { Destructibles } from './destructibles.js';
import { HighlightReel } from './highlight.js';
import { MapScreen } from './map.js';
import { GameAudio } from './audio.js';
import { GameCamera } from './camera.js';
import { GunnerView } from './gunner.js';
import { HUD, fmtTime } from './hud.js';
import { Input } from './input.js';
import { rollChoices } from './upgrades.js';
import { iconSVG } from './icons.js';
import { pickBackend, fallbackURL, retryURL } from './backend.js';
import { LOWMEM, PROFILE } from '../device-profile.js';
import { QualityGovernor } from './quality-governor.js';

// js/game/game.js
// EXTINCTION AVENUE — entry point and game state machine. A first-person arcade rail shooter: Unit 77 drives itself
// down the avenues and you are the REAR GUNNER, aiming the tail gun at the dinosaurs chasing the cab.
//
//   loading → title (attract: PRESS START) → intro (camera swoop into the gunner's hatch) → playing ⇄ levelup / paused
//           → bossintro (GRIDLOCK reveal) → playing → results (victory)
//   playing → dead (wreck) → continue (10 s countdown; continuing is free but resets the combo multiplier) → playing
//                                                   └ time out → results (game over)
//
// URL parameters (handy for testing and clips): ?quality=high|medium|low|phone  ?webgl (force WebGL2)  ?webgpu (WebGPU on Safari)
//   ?lowmem / ?lowmem=0 (force the phone memory profile on / off, see js/device-profile.js)
//   ?boss (start just before GRIDLOCK with a mid-game build)  ?t=SECONDS (start later in the run)  ?nointro
//   ?god (invulnerable)  ?test (no animation loop: drive the game from window.__game.step()/render(), headless tests)
//   ?autostart (skip the title; set by the WebGPU → WebGL2 fallback when the device died after START)
//   ?autoplay (test only: the game plays itself — aims at the nearest threat, fires, picks cards, continues, goes endless)

const params = new URLSearchParams(location.search);
// WebGPU on Chromium; WebGL2 on Safari / iOS (see backend.js) and wherever navigator.gpu is missing
const AUTOPLAY = params.has('autoplay');
// QA, soaks and the WebGL fallback skip the outbreak map and play the classic midtown run.
const SKIP_MAP = params.has('test') || params.has('nointro') || params.has('autoplay') || params.has('autostart') || params.has('boss') || params.has('t') || params.has('classic');
const BACKEND = pickBackend(navigator.userAgent || '', params, !!navigator.gpu);
const START_S = 120; // 5th Ave, a few blocks south of 57th St, heading downtown
const CONTINUE_SECONDS = 10;
const GAME_URL = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}` : 'https://midagedev.github.io/extinction-avenue/';
const TIPS = [
  'Shoot dinosaurs while they wind up (red ring) to STAGGER them out of the attack.',
  'Headshots deal 1.6x. GRIDLOCK\'s glowing collar deals 2.5x.',
  'Shoot the floating supply drops — repair kits, overdrive, air strikes.',
  'Empty belt? It reloads by itself. R or right click reloads early.',
  'Max a weapon and own its partner passive to EVOLVE it.',
  'Shoot the wrecked cars the T. rex throws out of the air.',
  'Skyhammer charges with every kill. SPACE calls it onto the crosshair.'
];

const SETTINGS_KEY = 'ea-settings';
const BEST_KEY = 'ea-best';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _hit = {};

function loadSettings() {
  const def = { shake: 1, numbers: true, autoFire: false, quality: LOWMEM ? 'phone' : 'high', touchAim: 'drag', touchSens: 1.5, aimAssist: true };
  let s = def;
  try { s = { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { /* storage unavailable */ }
  s.quality = qualityFor(s.quality);
  return s;
}

/** Low-memory devices only get the Phone and Low presets: High / Medium (an old saved setting, ?quality=high) become
 *  Phone, so a phone never allocates SSR targets or the shadow atlas. ?lowmem=0 lifts the cap. */
function qualityFor(q) {
  return LOWMEM && q !== 'low' ? 'phone' : q;
}

/** Every public GameAudio method swallows (and logs once) its own exceptions: sound must never break START or a frame */
function guardAudio(audio) {
  const proto = Object.getPrototypeOf(audio);
  for (const k of Object.getOwnPropertyNames(proto)) {
    const fn = Object.getOwnPropertyDescriptor(proto, k).value;
    if (k === 'constructor' || k.startsWith('_') || typeof fn !== 'function') continue;
    let warned = false;
    audio[k] = (...a) => {
      try { return fn.apply(audio, a); } catch (err) {
        if (!warned) { warned = true; console.warn(`[audio] ${k}() failed, continuing:`, err); }
        return undefined;
      }
    };
  }
  return audio;
}

/** Back to the loading screen with a message (and the Retry button for errors). Used for the backend fallback and
 *  every fatal error, so a failure is never a silent black screen. */
function showLoadingScreen(text, error = false) {
  for (const sc of document.querySelectorAll('.screen.open')) sc.classList.remove('open');
  document.body.className = document.body.className.replace(/\bs-\S+/g, '').replace(/\bcine\b/g, '').trim() + ' s-loading';
  const st = document.getElementById('load-status');
  if (st) st.textContent = text;
  const box = document.getElementById('load-error');
  if (box) box.hidden = !error;
}

function makeLivery() {
  const door = () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#ffbe14'; x.fillRect(0, 0, 256, 128);
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
    this.assist = false;
    this.aimRay = new THREE.Ray();
    this.calloutT = {};
    this.frames = 0;
    this.lastFrameAt = 0;
    this.runRequested = false; // the player pressed START (a backend fallback then lands straight back in a run)
  }

  /** Unrecoverable: stop rendering and show the error with "Retry (compatibility mode)" */
  fatal(msg, err) {
    if (this.dead) return;
    this.dead = true;
    if (err) console.error('[fatal]', msg, err);
    try { this.world?.renderer.setAnimationLoop(null); } catch { /* ignore */ }
    showLoadingScreen(msg, true);
  }

  /** WebGPU device lost / erroring: reload on WebGL2 (never loops — on WebGL2 already this becomes a fatal error) */
  gpuFallback(reason) {
    // Allowed over an error screen: a dying device often throws (shown by fatal()) before device.lost resolves
    if (this.fallingBack) return;
    const url = fallbackURL(location.href, { autostart: this.runRequested });
    if (!url) { this.fatal(`Graphics error (${reason}).`); return; }
    console.warn(`[webgpu] ${reason} — restarting on WebGL2`);
    this.fallingBack = this.dead = true;
    try { this.world?.renderer.setAnimationLoop(null); } catch { /* ignore */ }
    showLoadingScreen('Graphics driver reset — restarting in compatibility mode (WebGL2)…');
    setTimeout(() => location.replace(url), 1200);
  }

  /** After START: if the run hasn't reached 'playing' ~15 s later and frames stopped (or the intro never ends), say so */
  _armWatchdog() {
    clearInterval(this._wd);
    if (this.testMode) return;
    const t0 = performance.now(), f0 = this.frames;
    let hiddenFor = 0, last = t0;
    this._wd = setInterval(() => {
      const now = performance.now();
      if (document.hidden) hiddenFor += now - last; // rAF pauses in background tabs: not a hang
      last = now;
      if (this.dead || this.state !== 'intro') { clearInterval(this._wd); return; }
      const since = now - t0 - hiddenFor;
      const stalled = !document.hidden && now - Math.max(this.lastFrameAt, t0) > 10000;
      if (since > 15000 && (stalled || this.frames - f0 > 600)) {
        clearInterval(this._wd);
        this.fatal('Something went wrong — the game stopped responding.', new Error(`watchdog: state ${this.state}, ${this.frames - f0} frames since START`));
      }
    }, 1000);
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
    console.info(`[init] renderer backend: ${BACKEND}`);

    this.cam = new GameCamera();
    this.cam.shakeScale = this.settings.shake;
    const quality = qualityFor(params.get('quality') || this.settings.quality);
    if (LOWMEM) console.info(`[lowmem] phone memory profile (${PROFILE.reason}): quality ${quality}, city around the loop, streamed music`);
    let stage = 0.05;
    this.world = await createWorld(document.getElementById('canvas-container'), this.cam.camera, {
      quality, forceWebGL: BACKEND === 'webgl',
      onStatus: (t) => { stage = Math.min(0.45, stage + 0.08); setStatus(t, stage); }
    });
    const scene = this.world.scene;
    // A lost WebGPU device (driver reset, broken adapter) restarts the game on the WebGL2 backend, and so does a device
    // that keeps reporting validation/out-of-memory errors (> 20 within 10 s)
    const gpu = this.world.renderer.backend.device;
    gpu?.lost?.then((info) => {
      console.warn('[webgpu] device lost:', info?.reason, info?.message);
      if (info?.reason !== 'destroyed') this.gpuFallback(`device lost${info?.message ? `: ${info.message}` : ''}`);
    });
    if (gpu?.addEventListener) {
      let total = 0, recent = [];
      gpu.addEventListener('uncapturederror', (e) => {
        const now = performance.now();
        if (++total <= 5) console.warn(`[webgpu] uncaptured error #${total}:`, e.error?.message || e.error);
        recent = recent.filter((t) => now - t < 10000);
        recent.push(now);
        if (recent.length > 20) this.gpuFallback(`${recent.length} GPU errors in 10 s`);
      });
    }
    setStatus('Thawing specimens…', 0.5);
    this.assets = await loadAssets(ASSET_MANIFEST);
    if (LOWMEM) releaseModelCaches();
    this.route = new Route();
    this.walk = new WalkGrid(this.route);
    this.player = new Player(scene, this.assets, this.route, makeLivery());
    // The camera carries the first-person view model, so it has to be part of the scene graph
    scene.add(this.cam.camera);
    this.gunner = new GunnerView(this.cam.camera, this.assets, this.player.propMaterial);
    this.vfx = new VFX(scene, this.assets);
    this.vfx.showNumbers = this.settings.numbers;
    this.audio = guardAudio(new GameAudio());
    this.hud = new HUD(this);
    this.enemies = new EnemyManager(this, this.assets);
    scene.add(this.enemies.group);
    this.weapons = new WeaponSystem(this, this.assets);
    scene.add(this.weapons.group);
    this.pickups = new Pickups(this, this.assets);
    for (const m of this.pickups.meshes()) scene.add(m);
    this.boss = new TRexBoss(this, this.assets);
    for (const m of this.boss.meshes()) scene.add(m);
    this.destruct = new Destructibles(this, this.assets);
    this.director = new Director(this);
    this.progress = loadProgress();
    this.campaignStage = null;
    this.map = new MapScreen(this);
    this.highlight = new HighlightReel(this, { disabled: this.testMode || AUTOPLAY, lowmem: LOWMEM });
    this.input = new Input(this);
    this.input.onAction = (a) => this.onAction(a);
    this._applyTouchSettings();
    this.stats = this._freshStats();
    this._bindUI();

    // Title scene, then compile every pipeline behind the loading screen (with one instance in every batch/rig)
    this.setupTitle();
    this.cam.update(0.016, this.player);
    // Phones: only the city cells around the cab are resident (+ one piece of every material for the compile)
    const stream = this.world.stream;
    if (stream) {
      stream.setRoute(this.route);
      stream.prime(this.player.s);
      stream.addRepresentatives();
    }
    const batches = [];
    scene.traverse((o) => { if (o.isInstancedMesh && o.count === 0 && o.name && !o.name.startsWith('Manhattan')) batches.push(o); });
    for (const m of batches) m.count = 1;
    setStatus('Compiling shaders…', 0.55);
    await this.world.compile((p) => setStatus(`Compiling shaders… ${Math.round(p * 100)}%`, 0.55 + p * 0.4));
    this.world.warmup();
    stream?.dropStrays();
    if (stream) console.info('[lowmem] city stream', JSON.stringify(stream.info()));
    for (const m of batches) m.count = 0;
    if (LOWMEM) console.info(`[lowmem] released ${(this.world.releaseStaticArrays() / 1e6).toFixed(1)} MB of uploaded city vertex data`);
    setStatus('Ready', 1);
    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    // Phones: graphics step down while playing when frames run long or memory runs short (?governor=0: off)
    if (LOWMEM && !this.testMode && params.get('governor') !== '0') this.governor = new QualityGovernor({ world: this.world, onResize: () => this.onResize() });
    this.lastNow = performance.now();
    if (!this.testMode) {
      this.world.renderer.setAnimationLoop((now) => this.frame(now));
    }
    const device = this.world.renderer.backend.device;
    await Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {});
    this.setState('title');
    if (params.has('boss') || params.has('t') || params.has('autostart')) this.startRun(params.get('stage'));
  }

  _freshStats() {
    return { kills: 0, damageDealt: 0, damageTaken: 0, headshots: 0, staggers: 0, shotDown: 0, byType: {}, elites: 0, bossKilled: false, bossKillTime: 0, continues: 0, hitsTaken: 0 };
  }

  setState(s) {
    if (this.dead) return;
    this.state = s;
    document.body.className = document.body.className.replace(/\bs-\S+/g, '').trim() + ` s-${s}`;
    if (this.input?.touchMode) document.body.classList.add('touch');
  }

  // ------------------------------------------------------------------------------------------------------------------
  _bindUI() {
    const $ = (id) => document.getElementById(id);
    const click = (id, fn) => $(id)?.addEventListener('click', () => { this.audio.unlock(); this.audio.play('ui'); fn(); });
    click('btn-play', () => this._pressStart());
    click('btn-map-back', () => this.closeMap());
    click('btn-deploy', () => this.map.deploy());
    click('btn-tomap', () => this.openMap());
    click('btn-next', () => { this.hud.open('s-results', false); if (this._nextStage) this.startRun(this._nextStage); });
    click('btn-clip', () => this.highlight?.shareClip());
    click('btn-card', () => this.highlight?.shareCard());
    click('btn-howto', () => this.hud.open('s-howto'));
    click('btn-settings', () => this.openSettings());
    click('btn-pause-settings', () => this.openSettings());
    click('btn-resume', () => this.togglePause(false));
    click('btn-quit', () => { this.togglePause(false); this.endRun(false, true); });
    click('btn-again', () => { this.hud.open('s-results', false); this.startRun(this.campaignStage?.id || null); });
    click('btn-menu', () => { this.hud.open('s-results', false); this.setupTitle(); this.setState('title'); });
    click('btn-endless', () => this.continueEndless());
    click('btn-share', () => this.share());
    click('lu-reroll', () => this.reroll());
    click('btn-continue', () => this.doContinue());
    click('btn-giveup', () => this.giveUp());
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { this.audio.play('ui_back'); b.closest('.screen').classList.remove('open'); });
    for (const b of document.querySelectorAll('.btn')) b.addEventListener('pointerenter', () => this.audio.play('ui_hover'));
    // Settings
    const s = this.settings;
    const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } };
    // Audio: mute toggle, master / music / effects volume (remembered by GameAudio in localStorage), announcer voice
    const A = this.audio;
    const pct = (id, v) => { $(id).textContent = `${Math.round(v * 100)}%`; };
    for (const k of ['master', 'music', 'sfx']) {
      $(`set-${k}`).value = A.volume[k];
      pct(`set-${k}-v`, A.volume[k]);
      $(`set-${k}`).addEventListener('input', (e) => {
        A.unlock();
        A.volume[k] = +e.target.value;
        pct(`set-${k}-v`, A.volume[k]);
        A.applyVolumes();
        if (k === 'sfx') A.play('gun', { force: true });
      });
    }
    $('set-announcer').checked = A.announcer;
    $('set-announcer').addEventListener('change', (e) => { A.unlock(); A.setAnnouncer(e.target.checked); if (e.target.checked) A.play('vo_ready'); });
    this._syncMute();
    $('set-mute').addEventListener('click', () => { A.unlock(); A.setEnabled(!A.enabled); this._syncMute(); A.play('ui_click'); });
    click('btn-pause-mute', () => { A.setEnabled(!A.enabled); this._syncMute(); });
    $('set-shake').value = String(s.shake);
    $('set-numbers').checked = s.numbers;
    $('set-autofire').checked = s.autoFire;
    if (LOWMEM) {
      // Phones: Phone (default) or Low; the desktop presets need more memory than iOS allows a tab
      const sel = $('set-quality');
      for (const o of [...sel.options]) if (o.value === 'high' || o.value === 'medium') o.remove();
      sel.insertBefore(new Option('Phone', 'phone'), sel.firstChild);
    }
    $('set-quality').value = s.quality;
    $('set-touchaim').value = s.touchAim;
    $('set-touchsens').value = String(s.touchSens);
    $('set-assist').checked = s.aimAssist;
    $('set-shake').addEventListener('change', (e) => { s.shake = +e.target.value; this.cam.shakeScale = s.shake; save(); });
    $('set-numbers').addEventListener('change', (e) => { s.numbers = e.target.checked; this.vfx.showNumbers = s.numbers; save(); });
    $('set-autofire').addEventListener('change', (e) => { s.autoFire = e.target.checked; save(); });
    $('set-touchaim').addEventListener('change', (e) => { s.touchAim = e.target.value; this._applyTouchSettings(); save(); });
    $('set-touchsens').addEventListener('input', (e) => { s.touchSens = +e.target.value; this._applyTouchSettings(); save(); });
    $('set-assist').addEventListener('change', (e) => { s.aimAssist = e.target.checked; this._applyTouchSettings(); save(); });
    $('set-quality').addEventListener('change', (e) => { s.quality = e.target.value; save(); $('set-note').textContent = 'Graphics quality applies after a reload.'; });
    // Browsers only allow audio after a user gesture: unlock on the first one anywhere. This builds the graph and starts
    // whatever music state the game is in (title theme).
    this.audio.armGesture();
    const best = this._best();
    if (best.score) document.getElementById('best').innerHTML = `HI-SCORE <b>${best.score.toLocaleString('en-US')}</b>${best.boss ? ' · APEX DOWN' : ''}`;
  }

  openSettings() {
    this.hud.open('s-settings');
  }

  /** Mute button / pause-menu button / M key all show the same state */
  _syncMute() {
    const on = this.audio.enabled;
    const b = document.getElementById('set-mute');
    if (b) { b.setAttribute('aria-pressed', String(!on)); b.querySelector('b').textContent = on ? 'ON' : 'MUTED'; }
    const p = document.getElementById('btn-pause-mute');
    if (p) p.querySelector('b').textContent = on ? 'SOUND ON' : 'SOUND OFF';
    const c = document.getElementById('set-sound');
    if (c) c.checked = on;
  }

  onAction(a) {
    const st = this.state;
    if (a === 'mute') { this.audio.unlock(); this.audio.setEnabled(!this.audio.enabled); this._syncMute(); this.hud.prompt(this.audio.enabled ? 'SOUND ON' : 'SOUND MUTED', ''); return; }
    if (a === 'autofire') { this.settings.autoFire = !this.settings.autoFire; document.getElementById('set-autofire').checked = this.settings.autoFire; this.hud.prompt(this.settings.autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF', ''); return; }
    if (st === 'levelup') {
      if (a.startsWith('pick')) { const i = +a.slice(4) - 1; if (i < this.choices.length) this.pick(i); }
      if (a === 'reroll') this.reroll();
      return;
    }
    if (st === 'continue') {
      if (a === 'confirm' || a === 'special' || a === 'fire') this.doContinue();
      if (a === 'pause') this.giveUp();
      return;
    }
    if (a === 'pause' && (st === 'playing' || st === 'paused')) { this.togglePause(st === 'playing'); return; }
    if (a === 'clip' && (st === 'playing' || st === 'bossintro')) { this._armClip(); return; }
    if (st === 'map') {
      if (a === 'confirm' || a === 'special') this.map.deploy();
      if (a === 'pause') this.closeMap();
      return;
    }
    if (st === 'title' && (a === 'confirm' || a === 'special')) { this.audio.unlock(); this._pressStart(); return; }
    if (st === 'playing' && (a === 'reroll' || a === 'reload')) { if (this.weapons.reload()) this.hud.callout('RELOAD!', 'reload'); return; }
    if (st === 'playing' && a === 'special') {
      if (!this.weapons.triggerSpecial() && this.weapons.special.charge < 1) this.hud.prompt('SKYHAMMER CHARGING', '');
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
    this.weapons.recomputeStats();
    this.player.hp = this.player.maxHp;
    this.weapons.ammo = this.weapons.magSize;
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
    this.hud.clearCracks();
    this.victory = false;
    this.victoryT = undefined;
    this.slow = null;
    this.timeScale = 1;
    this.hintStep = 0;
    this.hintT = 0;
    this.cam.swing(0, 0, 10, 0);
    this.cam.swingYaw = 0;
    this.cam.swingPitch = 0;
    this.enemies.attackGrace = 8;
    this.calloutT = {};
    this.killHeat = 0;
    this.quietT = 0;
    this.bossMusicAsked = false;
    this.audio.setBossPhase(1);
    this._stageCleared = false;
    this.destruct?.reset();
  }

  _prepareRun(stageId) {
    const stage = stageId ? stageById(stageId) : null;
    if (stage) {
      this.campaignStage = stage;
      this.director.useStage(stage);
    } else {
      this.campaignStage = null;
      this.director.useClassic();
    }
  }

  _pressStart() {
    const stage = params.get('stage');
    if (stage) { this.startRun(stage); return; }
    if (SKIP_MAP) { this.startRun(null); return; }
    this.openMap();
  }

  openMap() {
    this.hud.open('s-results', false);
    this.hud.open('s-pause', false);
    this.hud.open('s-howto', false);
    this.hud.open('s-settings', false);
    this.setState('map');
    try { this.map.refresh(); } catch (err) { console.error('[map]', err); }
    this.hud.open('s-map', true);
  }

  closeMap() {
    this.hud.open('s-map', false);
    this.setupTitle();
  }

  setupTitle() {
    this.campaignStage = null;
    this.director.useClassic();
    this.hud?.open('s-map', false);
    this._resetRun();
    this.director.reset(0);
    this.player.update(0.016, 0);
    this.player.speed = 0;
    this.gunner.setVisible(false);
    // Attract shot: slow orbit around a point behind the parked cab, so the cab and the pack lined up behind it share
    // the frame
    const tp = this.player;
    this.cam.orbit({ x: tp.x - tp.fx * 9, z: tp.z - tp.fz * 9, y: 0 }, 21, 3.4, 0.07, tp.heading + 0.5, 50);
    this.cam.orbitState.lookY = 1.4;
    this.cam.snap = true;
    // A pack lined up behind the parked cab, a brute and a Hornwall waiting further back, pterosaurs circling
    const p = this.player;
    for (let i = 0; i < 10; i++) this.director.spawnChaser(i < 4 ? 'raptor' : 'compy', 'behind');
    for (const e of this.enemies.list) { e.s = this.route.wrap(p.s - 9 - Math.random() * 14); e.d = (Math.random() - 0.5) * 10; }
    const b = this.director.spawnChaser('brute', 'behind', { elite: true });
    if (b) { b.s = this.route.wrap(p.s - 20); b.slotGap = -20; }
    const t = this.director.spawnChaser('trike', 'behind');
    if (t) { t.s = this.route.wrap(p.s - 30); t.slotGap = -30; }
    this.director.spawnChaser('ptero', 'sky');
    this.director.spawnChaser('ptero', 'sky');
    this.audio.setMusic('title');
  }

  startRun(stageId = null) {
    if (this.dead) return;
    this._prepareRun(stageId);
    this.runRequested = true;
    this._armWatchdog();
    this.audio.unlock();
    this.hud.open('s-map', false);
    this.hud.open('s-results', false);
    this._resetRun();
    this.setState('intro');
    const start = this.campaignStage ? 0 : (params.has('boss') ? BOSS_TIME - 6 : Math.max(0, +(params.get('t') || 0)));
    this.director.reset(start);
    if (start > 0) this._grantBuild(start);
    if (this.campaignStage) this.player.reset(this.campaignStage.startS);
    this.audio.setMusic('run');
    if (LOWMEM && !this._released) { this._released = true; setTimeout(() => this.world.releaseStaticArrays(), 12000); }
    const p = this.player;
    p.update(0.016, 0);
    this.world.stream?.prime(p.s);
    this.gunner.setVisible(true);
    if (params.has('nointro') || this.testMode) {
      this.cam.setMode('gunner', true);
      this._beginPlay();
      return;
    }
    document.body.classList.add('cine');
    const air = new THREE.Vector3(), side = new THREE.Vector3(), look = new THREE.Vector3(), look2 = new THREE.Vector3(), behind = new THREE.Vector3(), behindLook = new THREE.Vector3();
    this.gunner.setVisible(false);
    this.cam.playCinematic([
      { t: 0, pos: () => air.set(p.x - p.fx * 70 - p.rx * 26, 60, p.z - p.fz * 70 - p.rz * 26), look: () => look.set(p.x, 0, p.z), fov: 55 },
      { t: 1.5, pos: () => side.set(p.x - p.fx * 8 + p.rx * 6, 1.6, p.z - p.fz * 8 + p.rz * 6), look: () => look2.set(p.x, 1.3, p.z), fov: 46 },
      { t: 2.7, pos: () => behind.set(p.x + p.fx * 1.5, 3.2, p.z + p.fz * 1.5), look: () => behindLook.set(p.x - p.fx * 20, 1.2, p.z - p.fz * 20), fov: 60 }
    ], () => {
      document.body.classList.remove('cine');
      this.gunner.setVisible(true);
      this.cam.setMode('gunner');
      this._beginPlay();
    });
    const card = this.campaignStage;
    this.hud.banner(card ? card.name : 'MIDTOWN · 7:14 PM', card ? card.objective : 'Unit 77 — you\'re on the tail gun', 'wave', true);
  }

  _beginPlay() {
    this.setState('playing');
    this.hud.callout('GO!', 'good');
    this.audio.play('bell');
    this.audio.play('vo_go');
    this.highlight?.beginRolling();
    this.hintStep = 0;
    this.hintT = 1.2;
  }

  /** Debug/test: a plausible build for starting mid-run */
  _grantBuild(t) {
    const picks = [['weapon', 'cannon'], ['weapon', 'gatling'], ['passive', 'hollow'], ['weapon', 'cannon'], ['weapon', 'missiles'], ['passive', 'turbo'],
      ['weapon', 'cannon'], ['weapon', 'gatling'], ['passive', 'hollow'], ['weapon', 'cannon'], ['weapon', 'tesla'], ['passive', 'chassis'], ['weapon', 'missiles'],
      ['passive', 'hollow'], ['weapon', 'gatling'], ['passive', 'ram'], ['evolution', 'railgun'], ['weapon', 'tesla']];
    const n = Math.min(picks.length, Math.round(t / 24));
    for (let i = 0; i < n; i++) this.weapons.apply({ kind: picks[i][0], id: picks[i][1] });
    this.level = n + 1;
    this.xpNeed = this._need(this.level);
    this.player.hp = this.player.maxHp;
    this.weapons.ammo = this.weapons.magSize;
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
    this.gunner.setVisible(true);
    this.cam.setMode('gunner');
    this.hud.banner('ENDLESS', 'Manhattan never sleeps', 'wave', true);
  }

  // ------------------------------------------------------------------------------------------------------------------
  frame(now) {
    const rawDt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    this.tick(Math.min(0.05, Math.max(0.0005, rawDt)));
    this.renderFrame();
    if (this.governor && this.state === 'playing') this.governor.update(rawDt);
    // START watchdog: a frame that completed (one slow software-rendered frame is not a hang, a throwing one is)
    this.frames++;
    this.lastFrameAt = performance.now();
  }

  tick(dt) {
    this.realTime += dt;
    this.input.update(dt);
    if (AUTOPLAY) this._autoplay(dt);
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
    if (st === 'continue') this._continueTick(dt);
    this.cam.update(dt, this.player);
    // After the camera, so near-lens fades use the pose that is about to be drawn.
    this.vfx.update(simulating ? sim : 0, this.cam.camera);
    this.player.tailGun.visible = this.cam.mode !== 'gunner';
    const u = this.world.post.uniforms;
    const p = this.player;
    u.hurt.value = Math.max(p.hurtFlash * 0.65, p.alive && p.hp / p.maxHp < 0.25 ? 0.3 + 0.2 * Math.sin(this.realTime * 6) : 0);
    u.aberration.value *= Math.max(0, 1 - dt * 4);
    u.desat.value += ((st === 'levelup' || st === 'paused' || st === 'continue' ? 0.8 : this.timeScale < 0.6 ? 0.45 : 0) - u.desat.value) * Math.min(1, dt * 6);
    u.flash.value *= Math.max(0, 1 - dt * 3);
    u.danger.value = this.boss.active ? 0.3 : 0;
    const c = this.cam.camera;
    c.getWorldDirection(_v);
    this.audio.setListener(c.position.x, c.position.y, c.position.z, _v.x, _v.y, _v.z);
    this.audio.updateLoops(p.speed, false, this.weapons.flaming, simulating && st !== 'title' && p.alive, this.weapons.spin || 0);
    this.highlight?.update(dt);
    this.audio.update(dt, st === 'playing' || st === 'intro' ? this._musicInfo(dt) : null);
    if (st !== 'loading' && st !== 'title') this.hud.update(dt);
    // Queued level-ups open as soon as the action allows
    if (this.state === 'playing' && this.victoryT === undefined && (this.pendingLevels > 0 || this.pendingCrates > 0) && p.alive && this.cam.mode === 'gunner' && this.enemies.attackers === 0) this.openLevelUp();
    this._hints(dt);
  }

  /**
   * Combat heat for the adaptive music (0–1): attackers, dinosaurs on screen, firing, recent kills, low hull, mini-bosses.
   * calm → breather cue (quiet beats, cleared zones, an empty street); hot → the high-intensity cue.
   */
  _musicInfo(dt) {
    const en = this.enemies, d = this.director, p = this.player;
    const beat = d.beat?.id;
    this.killHeat = Math.max(0, (this.killHeat || 0) - dt * 0.2);
    const lowHp = p.alive && p.hp / p.maxHp < 0.3;
    const heat = Math.min(1, en.attackers * 0.22 + en.threatCount / 18 + (this.weapons.firing ? 0.12 : 0) + this.killHeat + (lowHp ? 0.2 : 0) + (this.minibosses.length ? 0.35 : 0));
    this.quietT = en.threatCount === 0 ? (this.quietT || 0) + dt : 0;
    const calm = beat === 'calm' || beat === 'rollout' || (!!d.beat?.zone && d.zoneClear) || this.quietT > 4;
    const hot = this.minibosses.length > 0 || beat === 'stampede' || beat === 'alpha' || beat === 'matriarch';
    // Boss music is lazy: start fetching it ~1.5 minutes before GRIDLOCK is due
    if (!this.bossMusicAsked && (d.time > d.bossTime - 100 || d.endless)) { this.bossMusicAsked = true; this.audio.loadMusic(['boss_sting', 'boss1', 'boss2_intro', 'boss2', 'boss3']); }
    return { heat, calm, hot };
  }

  simulate(dt, realDt) {
    const st = this.state;
    const p = this.player;
    this.elapsed += dt;
    this.vfx.beginTelegraphs();
    this.vfx.threats.length = 0;
    if (st === 'playing') this.director.update(dt);
    p.update(dt, st === 'title' ? 0 : st === 'dead' ? 0 : this.director.cruise());
    // Aim + weapons
    this._updateAim(realDt);
    if (st === 'playing' && p.alive) {
      this.weapons.update(dt, { fire: this.input.fire || this.touchFire, autoFire: this.settings.autoFire });
    } else if (st === 'title') {
      this.weapons.sawBatch.begin(); this.weapons.sawBatch.end();
    }
    if (st !== 'playing' && st !== 'title') this.weapons._updateProjectiles(dt);
    this.enemies.update(dt);
    this.boss.update(dt);
    this.pickups.update(dt);
    this.destruct?.update(dt);
    // Pose every rig now (cheap CPU work): hit spheres and the boss weak points need it even when nothing renders
    this.enemies.render(this.elapsed);
    // Combo decay
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.vfx.endTelegraphs();
    if (this.minibosses.length && !this.boss.active) {
      const mb = this.minibosses[0];
      if (!mb.alive || mb.hp <= 0) this.minibosses.shift();
    }
    if (st === 'dead') {
      this.deadT -= realDt;
      if (Math.random() < 0.3) this.vfx.smoke.spawn(p.x, 0.6, p.z, (Math.random() - 0.5), 2.2, (Math.random() - 0.5), 1.1, 0.35, 0.9, 0.08, 0.08, 0.08, { drag: 1 });
      if (Math.random() < 0.2) this.vfx.glow.spawn(p.x + (Math.random() - 0.5) * 2, 0.4, p.z + (Math.random() - 0.5) * 2, 0, 1.6, 0, 0.4, 0.22, 0.55, 3.5, 1.2, 0.2, { r1: 0.9, g1: 0.12, b1: 0 });
      if (this.deadT <= 0) this.openContinue();
    }
    if (this.victoryT !== undefined && this.victoryT > 0) {
      if (!p.alive) this.victoryT = undefined;
      else {
        this.victoryT -= realDt;
        if (this.victoryT <= 0) this.endRun(true);
      }
    }
  }

  renderFrame() {
    this.world.stream?.update(this.player.s);
    if (this.state !== 'playing' && this.state !== 'title' && this.state !== 'intro' && this.state !== 'bossintro' && this.state !== 'dead') this.enemies.render(this.elapsed);
    this.world.update(this.cam.camera, this.elapsed);
    this.world.render();
    this.vfx.drawOverlay(this.cam.camera, this.enemies.dangers);
  }

  // ------------------------------------------------------------------------------------------------------------------
  /** Crosshair → ray. Whatever is under it is the target; the gun model swivels toward it. */
  _updateAim(realDt = 0.016) {
    const W = window.innerWidth, H = window.innerHeight;
    const inp = this.input;
    const aim = this.weapons.aim;
    if (inp.touching && inp.touchSettings.assist) this._aimAssist(realDt, W, H);
    const mx = inp.mouse.x, my = inp.mouse.y;
    const ndcX = (mx / W) * 2 - 1, ndcY = -(my / H) * 2 + 1;
    const ray = this.cam.ray(ndcX, ndcY);
    this.aimRay.copy(ray);
    this.cam.sway.x += (ndcX - this.cam.sway.x) * Math.min(1, realDt * 4);
    this.cam.sway.y += (ndcY - this.cam.sway.y) * Math.min(1, realDt * 4);
    const h = this.enemies.raycast(ray, 220, _hit);
    let t = 60;
    if (h) t = h.t;
    else if (ray.direction.y < -0.01) t = Math.min(160, (ray.origin.y - 0.05) / -ray.direction.y);
    _v2.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    aim.x = _v2.x; aim.y = _v2.y; aim.z = _v2.z;
    aim.target = h ? h.e : null;
    aim.weak = h ? h.weak > 1 : false;
    // Touch trigger: drag mode fires only while the crosshair is on something shootable (a short grace bridges gaps
    // between pellets and twitchy targets); offset mode fires whenever the finger is down, like the classic light gun
    let onShootable = !!h;
    if (!onShootable && inp.touching) onShootable = !!(this.boss.raycastWrecks(ray, t + 1) || this.pickups.raycast(ray, t + 1) || this.destruct?.raycast(ray, t + 1));
    this.touchOnT = onShootable ? 0.14 : Math.max(0, (this.touchOnT || 0) - realDt);
    this.touchFire = inp.touching && (inp.touchSettings.mode === 'offset' || this.touchOnT > 0);
    // Aim-assist friction: the crosshair slows down over a target (touch drag only)
    inp.assistSlow = inp.touching && inp.touchSettings.assist && h ? 0.62 : 1;
    // Skyhammer lands where the crosshair meets the street
    this.cam.aimPoint(ndcX, ndcY, 0.3, _v);
    aim.gx = _v.x; aim.gz = _v.z;
    if (this.gunner.visible) this.gunner.update(realDt, _v2, this.weapons.reloadT > 0 ? 1 - this.weapons.reloadT / this.weapons.reloadDur : 0);
    if (this.state === 'playing' || this.state === 'bossintro' || this.state === 'intro') {
      this.hud.reticle(mx, my, this.weapons.firing || (this.touchFire && this.weapons.reloadT <= 0), h ? (h.weak > 1 ? 'weak' : 'enemy') : null, this.weapons.heat, inp.touching);
    }
  }

  /**
   * Touch aim assist (mild): while a finger is down, the crosshair is pulled gently toward the nearest on-screen target
   * point (heads, the boss collar, thrown cars) within ~10 % of the screen; the pull fades with distance and is too weak
   * to drag the crosshair off a target the player is tracking. Friction (slower drag over a target) is applied in Input.
   */
  _aimAssist(dt, W, H) {
    const m = this.input.mouse;
    const cam = this.cam.camera;
    const R = Math.min(W, H) * 0.1 + 16;
    let best = null, bd = R * R;
    const consider = (x, y, z) => {
      _v.set(x, y, z).project(cam);
      if (_v.z >= 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) return;
      const sx = (_v.x * 0.5 + 0.5) * W, sy = (-_v.y * 0.5 + 0.5) * H;
      const d2 = (sx - m.x) ** 2 + (sy - m.y) ** 2;
      if (d2 < bd) { bd = d2; best = best || {}; best.x = sx; best.y = sy; }
    };
    for (const e of this.enemies.list) {
      if (e.ghost || e.state === 'dying' || e.state === 'launched') continue;
      if (e.boss) { const c = this.boss.collar; consider(c.x, c.y, c.z); continue; }
      consider(e.hx, e.hy, e.hz);
      consider(e.bx, e.by, e.bz);
    }
    for (const w of this.boss.wrecks) consider(w.x, w.y, w.z);
    if (!best) return;
    const d = Math.sqrt(bd);
    const k = Math.min(1, dt * 4) * 0.55 * (1 - d / R);
    m.x += (best.x - m.x) * k;
    m.y += (best.y - m.y) * k;
  }

  _applyTouchSettings() {
    const s = this.settings, t = this.input.touchSettings;
    t.mode = s.touchAim === 'offset' ? 'offset' : 'drag';
    t.sens = THREE.MathUtils.clamp(+s.touchSens || 1.5, 0.5, 3);
    t.assist = !!s.aimAssist;
    document.body.classList.toggle('aim-offset', t.mode === 'offset');
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Hooks called by the systems
  hurtPlayer(dmg, x, z, kind, src = null) {
    const p = this.player;
    if (this.state !== 'playing' || !p.alive || params.has('god')) return 0;
    const dealt = p.hurt(dmg);
    if (!dealt) return 0;
    this.stats.damageTaken += dealt;
    this.stats.hitsTaken++;
    this.cam.addTrauma(Math.min(0.75, 0.3 + dealt * 0.02));
    this.world.post.uniforms.aberration.value = Math.min(1, 0.35 + dealt * 0.04);
    this.audio.play('hurt', { volume: 0.9, pitch: 0.9 + Math.random() * 0.2 });
    // Where the hit came from, on screen (for the cracked-glass splat)
    let sx = 0.5, sy = 0.62;
    if (src) {
      _v.set(src.hx ?? x, src.hy ?? 1.5, src.hz ?? z).project(this.cam.camera);
      if (_v.z < 1) { sx = THREE.MathUtils.clamp(_v.x * 0.5 + 0.5, 0.12, 0.88); sy = THREE.MathUtils.clamp(-_v.y * 0.5 + 0.5, 0.15, 0.8); }
    }
    this.hud.hurt(dealt, sx, sy, kind);
    if (this.combo >= 3) this.hud.callout('COMBO BROKEN', 'bad');
    this.combo = 0;
    this.comboT = 0;
    if (!p.alive) this.onPlayerDeath();
    return dealt;
  }

  onTelegraph(e) {
    // DANGER! callout (rate-limited); the overlay draws the red ring around the attacker
    if (this.realTime - (this.calloutT.danger || -9) > 3) {
      this.calloutT.danger = this.realTime;
      this.hud.callout('DANGER!', 'danger');
      this.audio.play('danger');
      if (this.realTime - (this.calloutT.lookout || -99) > 40) { this.calloutT.lookout = this.realTime; this.audio.play('vo_lookout', { delay: 0.15 }); }
    }
    void e;
  }

  onStagger(e) {
    this.stats.staggers++;
    const big = e.boss || e.miniboss || e.sp.mass > 3;
    this.addScore((big ? 2000 : 200) * this.comboMult());
    this.vfx.number(e.hx ?? e.x, (e.hy ?? 2) + 0.8, e.hz ?? e.z, big ? 'STAGGER! +2000' : 'STAGGER', 4);
    if (big) { this.hud.callout('STAGGER!', 'good'); this.flash(0.12); }
    this.audio.play('combo', { pitch: 1.4, volume: 0.7 });
  }

  onGunHit(e, h, killed, x, y, z) {
    this.hud.hitmark(h.weak > 1, killed);
    // Hit marker tick; a brighter "ding" for headshots / the collar (rate-limited in the mixer)
    if (h.weak > 1 || h.head) this.audio.play('headshot', { pitch: killed ? 1.08 : 1 });
    else this.audio.play('hitmarker', { pitch: killed ? 0.9 : 1 });
    if (h.head && killed && !e.boss) {
      this.stats.headshots++;
      this.vfx.number(x, y + 0.5, z, 'HEADSHOT', 1);
    }
    if (e.boss && h.weak >= 2.5 && this.realTime - (this.calloutT.collar || -9) > 6) {
      this.calloutT.collar = this.realTime;
      this.hud.prompt('WEAK POINT!', 'good');
    }
  }

  onEmpty() {
    this.hud.callout('RELOAD!', 'reload');
  }

  onReloaded() {
    this.hud.ammoPulse();
  }

  onWindowHit(e) {
    this.hud.crack(0.5 + (Math.random() - 0.5) * 0.3, 0.4 + (Math.random() - 0.5) * 0.2, 1.4);
    void e;
  }

  onPickupShot(it) {
    this.hud.callout(it.type === 'repair' ? 'REPAIR!' : it.type === 'overdrive' ? 'OVERDRIVE!' : it.type === 'airstrike' ? 'SKYHAMMER!' : 'SUPPLY!', 'good');
  }

  onStorefront(x, z, sign, r) {
    // Glass bursts out of the shop front onto the sidewalk
    for (let k = 0; k < 24; k++) {
      const a = (Math.random() - 0.5) * 2;
      this.vfx.streak.spawn(x + r.hx * a * 2, 1 + Math.random() * 3, z + r.hz * a * 2, -r.rx * sign * (4 + Math.random() * 6) + r.hx * a * 3, 1 + Math.random() * 4, -r.rz * sign * (4 + Math.random() * 6) + r.hz * a * 3,
        0.6 + Math.random() * 0.5, 0.12, 0.04, 2.4, 3.2, 3.6, { grav: 14, drag: 0.8, stretch: 0.02, bounce: 0.3 });
    }
    this.vfx.dust(x, z, 1.4, 5);
    this.audio.play('glass', { x, z, volume: 1 });
    this.cam.addTrauma(0.12);
  }

  onZoneEnter(b) {
    this.hud.callout('STOP! COMBAT ZONE', 'danger');
    void b;
  }

  onZoneClear(t) {
    const bonus = Math.max(2000, Math.round(12000 - t * 150));
    this.addScore(bonus);
    this.hud.banner('ZONE CLEAR', `+${bonus.toLocaleString('en-US')} · Moving out!`, 'good', true);
    this.hud.callout('GO! GO! GO!', 'good');
    this.audio.play('zone_clear');
    this.pickups.spawnFloating('repair', -12);
  }

  onRam() { /* kept for compatibility (no ramming in the rail shooter) */ }

  onCannonHit() { this.hud.hitmark(false, false); }

  onEnemyKilled(e, cause) {
    if (e.ghost) return;
    const st = this.stats;
    st.kills++;
    st.byType[e.type] = (st.byType[e.type] || 0) + 1;
    if (e.elite) st.elites++;
    if (e.boss) { this.onBossKilled(e); return; }
    this.combo++;
    this.comboT = 3.2;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    const callouts = { 10: 'NICE!', 20: 'GREAT!', 30: 'EXCELLENT!', 50: 'RAMPAGE!', 80: 'MASS EXTINCTION!', 120: 'K-PG BOUNDARY!' };
    if (callouts[this.combo]) {
      this.hud.callout(callouts[this.combo], 'combo');
      this.audio.play('combo', { pitch: 1 + this.combo / 200 });
      if (this.combo === 20) this.audio.play('vo_combo', { delay: 0.1 });
      else if (this.combo === 50 || this.combo === 120) this.audio.play('vo_multikill', { delay: 0.1 });
    }
    this.killHeat = Math.min(0.4, (this.killHeat || 0) + 0.03);
    const sc = e.sp.score * (e.elite ? 4 : 1) * (e.miniboss ? 5 : 1);
    const pts = Math.round(sc * this.comboMult());
    this.addScore(pts);
    this.vfx.number(e.hx ?? e.x, (e.hy ?? 1.5) + 1.1, e.hz ?? e.z, `+${pts}`, 3);
    this.weapons.addCharge((e.elite ? 0.12 : 0.012) * (e.sp.mass > 3 ? 3 : 1));
    const spraying = (this.weapons.spin || 0) > 0.55 && !e.elite && !e.miniboss;
    if (e.sp.mass * e.scale > 3) this.hitStop(e.elite ? 0.08 : 0.045);
    else if (!spraying) this.hitStop(0.012);
    if (e.miniboss) {
      this.hud.banner('MINI-BOSS DOWN', e.name, 'good', true);
      this.hud.callout('FOSSILIZED', 'combo');
      this.flash(0.35);
      this.cam.addTrauma(0.55);
      this.cam.fovKick -= 5.5;
      this.slowmo(0.35, 1.25);
      this.highlight?.mark('finale');
    }
    void cause;
  }

  dropLoot(e) {
    const xp = e.sp.xp * (e.elite ? 4 : 1) * (e.miniboss ? 4 : 1);
    if (xp > 0) {
      const n = xp >= 40 ? 4 : xp >= 12 ? 2 : 1;
      for (let i = 0; i < n; i++) this.pickups.gem(e.x, e.z, xp / n);
    }
    if (e.dropCrate) this.pickups.spawnItem('crate', e.x, e.z);
    const big = e.sp.mass > 3;
    const r = Math.random();
    if (r < (big ? 0.12 : 0.015)) this.pickups.spawnItem('repair', e.x, e.z);
    else if (r < (big ? 0.16 : 0.02)) this.pickups.spawnItem('overdrive', e.x, e.z);
  }

  collectItem(type, x, z) {
    const p = this.player;
    switch (type) {
      case 'crate':
        this.pendingCrates++;
        this.audio.play('crate');
        this.hud.banner('SUPPLY DROP', 'Cretagen crate secured', 'good');
        break;
      case 'repair': {
        const amt = 30;
        p.heal(amt);
        this.hud.prompt(`+${amt} HULL`, 'good');
        this.audio.play('heal');
        this.hud.healFlash();
        break;
      }
      case 'overdrive':
        this.weapons.overdrive = 8;
        this.weapons.ammo = this.weapons.magSize;
        this.weapons.reloadT = 0;
        this.hud.banner('OVERDRIVE', 'Bottomless belt · +50% fire rate', 'special');
        this.audio.play('overdrive');
        this.audio.play('vo_powerup', { delay: 0.25 });
        break;
      case 'airstrike':
        this.weapons.special.charge = 1;
        this.hud.banner('SKYHAMMER READY', 'Press SPACE to call it onto the crosshair', 'special');
        this.audio.play('crate');
        break;
    }
    void x; void z;
  }

  addScore(v, label = null) {
    this.score += Math.round(v);
    if (label) this.hud.prompt(`+${Math.round(v)} ${label}`, 'good');
  }

  comboMult() {
    const c = this.combo;
    return c >= 60 ? 8 : c >= 40 ? 6 : c >= 25 ? 5 : c >= 15 ? 4 : c >= 8 ? 3 : c >= 3 ? 2 : 1;
  }

  _need(level) {
    return Math.round(12 + level * 7 + level * level * 0.9);
  }

  addXP(v) {
    if (this.state === 'title') return;
    this.xp += v * (this.weapons.xpMult || 1);
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
    this.input.mouse.down = false;
    this.audio.play(this.choices[0]?.kind === 'evolution' ? 'evolve' : 'levelup');
    this.audio.play('card_show', { delay: 0.25 });
    if (!crate && this.realTime - (this.calloutT.vlevel || -99) > 30) { this.calloutT.vlevel = this.realTime; this.audio.play('vo_levelup', { delay: 0.35 }); }
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
    this.audio.play('reroll');
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
    } else this.audio.play('card_pick');
    if (this.choiceCrate) this.pendingCrates--; else this.pendingLevels--;
    this.hud.hideLevelUp();
    this.audio.setMuffled(false);
    this.setState('playing');
    // A breath of slow motion and a moment's grace before the action resumes
    this.timeScale = 0.25;
    this.enemies.attackGrace = Math.max(this.enemies.attackGrace, 0.8);
  }

  whoaPunch(trauma = 0.4, fov = 3, stop = 0.04) {
    this.cam.addTrauma(trauma);
    if (fov) this.cam.fovKick -= fov;
    if (stop) this.hitStop(stop);
  }

  _armClip() {
    if (!this.highlight || this.highlight.disabled || !this.highlight.can) {
      this.hud.prompt('SCREENSHOT THE RESULTS CARD', '');
      return;
    }
    this.highlight.mark('finale');
    this.hud.prompt(this.highlight.lowmem ? 'RECORDING THE NEXT 14s' : 'CLIP ROLLING', 'good');
  }

  /** A map sector's script is done (no T. rex on this one). */
  onStageClear() {
    if (this._stageCleared) return;
    this._stageCleared = true;
    this.whoaPunch(0.55, 5.5, 0.1);
    this.slowmo(0.4, 1.4);
    this.flash(0.3);
    this.audio.play('zone_clear');
    this.audio.play('vo_mission', { delay: 0.35 });
    const name = this.campaignStage?.name || 'SECTOR';
    this.hud.banner('SECTOR CLEAR', name, 'good', true);
    this.hud.callout('CLEAR!', 'good');
    this.addScore(20000);
    this.victoryT = 2.2;
  }

  // ------------------------------------------------------------------------------------------------------------------
  startBoss() {
    this.bossStartT = this.director.time;
    this.boss.start();
  }

  bossIntro(e) {
    this.setState('bossintro');
    this.vfx.showNumbers = false;
    document.body.classList.add('cine');
    this.gunner.setVisible(false);
    this.slowmo(0.3, 3.4);
    const p = this.player;
    const boss = this.boss;
    const a = this.cam.camera.position.clone(), al = this.cam.look.clone();
    const k1 = new THREE.Vector3(), k2 = new THREE.Vector3(), head = new THREE.Vector3(), rp = new THREE.Vector3(), rl = new THREE.Vector3();
    const fwd = () => [Math.sin(e.heading), Math.cos(e.heading)];
    this.cam.playCinematic([
      { t: 0, pos: a, look: al, fov: 60 },
      { t: 0.5, pos: () => { const [fx, fz] = fwd(); return k1.set(e.rx + fx * 26 + fz * 9, 3.2, e.rz + fz * 26 - fx * 9); }, look: () => head.copy(boss.headPos).setY(boss.headPos.y * 0.75), fov: 40 },
      { t: 2.9, pos: () => { const [fx, fz] = fwd(); return k2.set(e.rx + fx * 20 + fz * 6, 2.6, e.rz + fz * 20 - fx * 6); }, look: () => head.copy(boss.headPos).setY(boss.headPos.y * 0.8), fov: 33 },
      { t: 3.6, pos: () => rp.set(p.x + p.fx * 1.5, 3, p.z + p.fz * 1.5), look: () => rl.set(p.x - p.fx * 16, 3.2, p.z - p.fz * 16), fov: 60 }
    ], () => {
      document.body.classList.remove('cine');
      this.gunner.setVisible(true);
      this.cam.setMode('gunner');
      this.setState('playing');
      this.vfx.showNumbers = this.settings.numbers;
      this.hud.prompt('SHOOT THE COLLAR!', 'good');
      this.enemies.attackGrace = 2;
    });
    setTimeout(() => this.hud.nameCard('CRETAGEN APEX SPECIMEN T-01', 'GRIDLOCK', 'Tyrannosaurus rex · 9.6 m · Containment: FAILED'), this.testMode ? 0 : 500);
    // The name card gets the stage: music dips under the reveal roar and the card
    this.audio.duck(-10, 3.2, 1.5);
    this.hud.showBoss(e, 'GRIDLOCK', 'Cretagen Apex Specimen T-01 · Tyrannosaurus rex', false);
  }

  onBossKilled(e) {
    this.hitStop(0.18);
    this.slowmo(0.45, 2.4);
    this.stats.bossKilled = true;
    this.stats.bossKillTime = this.director.time - (this.bossStartT ?? this.director.time);
    this.flash(0.5);
    this.audio.play('trex_death', { volume: 1.2 });
    this.audio.duck(-14, 3.5, 1.5);
    const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
    this.gunner.setVisible(false);
    this.cam.swing(0, 0, 3, 0);
    this.cam.orbit({ get x() { return e.rx + fx * 3; }, get z() { return e.rz + fz * 3; }, y: 0 }, 25, 12, 0.3, e.heading + 0.9, 50);
    this.cam.orbitState.lookY = 3;
    this.vfx.showNumbers = false;
    this.hud.banner('APEX DOWN', 'GRIDLOCK is going extinct', 'boss', true);
    for (const o of this.enemies.list) if (!o.boss) this.enemies.kill(o, 'boss', { launch: true, vy: 8 });
  }

  onBossDefeated() {
    this.director.bossActive = false;
    this.director.bossDone = true;
    this.addScore(50000);
    this.vfx.number(this.player.x, 4, this.player.z, '+50,000 APEX BONUS', 4);
    // Victory sting (chains into the results loop) + the announcer
    this.audio.setMusic('victory');
    this.audio.play(this.stats.continues ? 'vo_mission' : 'vo_flawless', { delay: 1.2 });
    this.victoryT = 4;
  }

  onPlayerDeath() {
    const p = this.player;
    this.setState('dead');
    this.deadT = 2.2;
    this.slowmo(0.3, 2);
    this.hitStop(0.15);
    this.vfx.explosion(p.x, 1, p.z, 3, 0);
    this.audio.play('death');
    this.audio.duck(-10, 2, 1);
    this.cam.addTrauma(1);
    this.flash(0.4);
    this.gunner.setVisible(false);
    this.cam.swing(0, 0, 10, 0);
    this.cam.orbit({ x: p.x, z: p.z, y: 0 }, 14, 6, 0.4, p.heading + 2.4, 50);
    this.hud.banner('UNIT 77 DOWN', 'The cab is wrecked', 'boss', true);
    this.input.mouse.down = false;
  }

  openContinue() {
    this.setState('continue');
    this.continueT = CONTINUE_SECONDS;
    this.musicBeforeContinue = this.boss.active ? 'boss' : 'run';
    this.audio.setMusic('continue');
    this.hud.showContinue(this.score, this.stats.continues);
    this.hud.continueCount(CONTINUE_SECONDS);
  }

  _continueTick(dt) {
    const before = Math.ceil(this.continueT);
    this.continueT -= dt;
    const n = Math.max(0, Math.ceil(this.continueT));
    if (n !== before) {
      this.hud.continueCount(n);
      if (n > 0) this.audio.play('count_tick', { pitch: 0.85 + (10 - n) * 0.035 });
      if (n === 3) this.audio.play('vo_hurry', { delay: 0.2 });
    }
    if (this.continueT <= 0) this.giveUp();
  }

  /** Free continue: full hull, the street around the cab is cleared, the combo multiplier resets */
  doContinue() {
    if (this.state !== 'continue') return;
    this.stats.continues++;
    this.hud.hideContinue();
    this.audio.setMusic(this.musicBeforeContinue || 'run');
    this.audio.play('levelup');
    this.audio.play('vo_ready', { delay: 0.3 });
    const p = this.player;
    p.revive();
    this.combo = 0;
    this.comboT = 0;
    this.hud.clearCracks();
    for (const o of this.enemies.list) if (!o.boss && !o.ghost) this.enemies.kill(o, 'continue', { launch: true, vy: 7 });
    this.vfx.shockwave(p.x, p.z, 30, 1.2, 4, 6, 0.8);
    this.enemies.attackGrace = 4;
    this.weapons.ammo = this.weapons.magSize;
    this.weapons.reloadT = 0;
    const be = this.boss.e;
    if (be && this.boss.active && be.mode !== 'cameo') { be.bs = this.route.wrap(p.s - 34); be.mode = 'chase'; be.stateT = 0; be.atkCd = 4; this.boss._clearView(); }
    this.gunner.setVisible(true);
    this.cam.setMode('gunner');
    this.setState('playing');
    this.hud.callout('CONTINUE!', 'good');
    this.hud.banner('BACK IN THE FIGHT', `Continue ${this.stats.continues} · combo multiplier reset`, 'wave', true);
  }

  giveUp() {
    if (this.state !== 'continue') return;
    this.hud.hideContinue();
    this.endRun(false);
  }

  endRun(win, quit = false) {
    if (this.state === 'results') return;
    this.victoryT = undefined;
    this.highlight?.cut();
    const best = this._best();
    const time = this.director.time;
    const stage = this.campaignStage;
    let stars = 0;
    let nextId = null;
    if (stage) {
      const applied = applyResult(this.progress, stage, { win: !!win && !quit, score: this.score, time, continues: this.stats.continues });
      stars = applied.stars;
      saveProgress(this.progress);
      const idx = STAGES.findIndex((s) => s.id === stage.id);
      if (win && !quit && STAGES[idx + 1] && isUnlocked(this.progress, STAGES, idx + 1)) nextId = STAGES[idx + 1].id;
    }
    this._nextStage = nextId;
    const finale = !stage || stage.finale === 'trex';
    const r = {
      win, score: this.score, time, kills: this.stats.kills, level: this.level, maxCombo: this.maxCombo, headshots: this.stats.headshots, staggers: this.stats.staggers,
      continues: this.stats.continues, boss: this.stats.bossKilled, bossTime: this.stats.bossKillTime, build: this.weapons.buildList(), endless: this.director.endless,
      stars, stageName: stage?.name || '',
      nextId,
      endlessOffer: !!(win && !quit && !this.director.endless && finale),
      title: win ? (stage && stage.finale !== 'trex' ? 'SECTOR CLEAR' : 'CITY SAVED') : quit ? 'OFF DUTY' : 'GAME OVER',
      sub: win
        ? (stage && stage.finale !== 'trex'
          ? `${stage.place} · ${fmtTime(time)} · ${this.stats.kills.toLocaleString('en-US')} fossilized${this.stats.continues ? '' : ' · NO CONTINUES'}`
          : `GRIDLOCK fossilized in ${fmtTime(this.stats.bossKillTime)} · ${this.stats.kills.toLocaleString('en-US')} dinosaurs down${this.stats.continues ? ` · ${this.stats.continues} continue${this.stats.continues > 1 ? 's' : ''}` : ' · NO CONTINUES'}`)
        : `Unit 77 held ${stage?.place || 'Midtown'} for ${fmtTime(time)}`,
      best: best.score, newBest: this.score > (best.score || 0)
    };
    if (r.newBest) {
      try { localStorage.setItem(BEST_KEY, JSON.stringify({ score: this.score, time, boss: this.stats.bossKilled })); } catch { /* ignore */ }
      document.getElementById('best').innerHTML = `HI-SCORE <b>${this.score.toLocaleString('en-US')}</b>${this.stats.bossKilled ? ' · APEX DOWN' : ''}`;
    }
    this.lastResult = r;
    this.vfx.showNumbers = this.settings.numbers;
    this.gunner.setVisible(false);
    this.setState('results');
    this.audio.setMuffled(false);
    // Game over: jingle + announcer, then the results loop (a win is already playing the victory sting)
    if (!win && !quit) { this.audio.setMusic('gameover'); this.audio.play('vo_gameover', { delay: 0.4 }); } else this.audio.setMusic('results');
    if (r.newBest && r.score > 0) this.audio.play('vo_highscore', { delay: win ? 3.2 : 2.4 });
    this.hud.hideBoss();
    this.hud.showResults(r);
  }

  _best() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; }
  }

  shareText(r = this.lastResult) {
    if (!r) return 'EXTINCTION AVENUE — rush hour just went Cretaceous. #ExtinctionAvenue';
    const weapons = (r.build || []).filter((b) => b.kind === 'weapon').map((b) => b.name).slice(0, 3).join(' + ');
    const stars = r.stars ? `${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)} ` : '';
    const where = r.stageName ? `${r.stageName} · ` : '';
    const head = r.win
      ? (r.stageName && r.stageName !== 'GRIDLOCK'
        ? `${stars}I cleared ${r.stageName} in EXTINCTION AVENUE`
        : `I put down GRIDLOCK the T. rex in ${fmtTime(r.bossTime)}${r.continues ? '' : ' with no continues'}`)
      : `I held the tailgate for ${fmtTime(r.time)} of the Manhattan dinosaur outbreak`;
    return `${head}\n${where}${r.score.toLocaleString('en-US')} pts · ${r.kills.toLocaleString('en-US')} dinos fossilized · ${r.headshots} headshots · ${r.maxCombo}x combo\nBuild: ${weapons}\nCan you beat it? #ExtinctionAvenue`;
  }

  shareURL(r = this.lastResult) {
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(this.shareText(r))}&url=${encodeURIComponent(GAME_URL)}`;
  }

  share() {
    window.open(this.shareURL(), '_blank', 'noopener,noreferrer,width=600,height=520');
  }

  // ------------------------------------------------------------------------------------------------------------------
  _hints(dt) {
    if (this.state !== 'playing' || this.director.time > 45) { if (this.hintStep < 99 && this.hintStep > 0) { this.hud.hint(null, false); this.hintStep = 99; } return; }
    this.hintT -= dt;
    if (this.hintT > 0) return;
    const touch = this.input.touchMode;
    const steps = touch
      ? [this.input.touchSettings.mode === 'offset' ? '<b>TOUCH BELOW</b> a dinosaur — the crosshair sits above your finger' : '<b>DRAG ANYWHERE</b> to move the crosshair — it fires while you hold it on a dinosaur', 'Hit them during the <b class="red">red ring</b> to stagger', '<b>RELOAD</b> button — or empty the belt']
      : [`${iconSVG('mouse')} <b>AIM</b> + <b>HOLD LEFT CLICK</b> to fire`, 'Shoot them during the <b class="red">red ring</b> to <b>STAGGER</b>', '<kbd>R</kbd> / right click <b>RELOAD</b> · <kbd>SPACE</kbd> <b>SKYHAMMER</b>'];
    if (this.hintStep < steps.length) {
      this.hud.hint(steps[this.hintStep], true);
      this.hintStep++;
      this.hintT = 6;
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

  /** ?autoplay (memory soaks, tools/mem-long-probe.mjs): aim at the closest threat and fire, take the first card, continue
   *  after a wreck and go endless after the boss. Inert without the flag. */
  _autoplay(dt) {
    const st = this.state;
    if (st === 'levelup') return this.pick(0);
    if (st === 'continue') return this.doContinue();
    if (st === 'results' && this.victory) return this.continueEndless();
    if (st === 'results') return this.startRun();
    if (st !== 'playing') return;
    this._apT = (this._apT || 0) - dt;
    if (this._apT > 0) return;
    this._apT = 0.1;
    const t = this.threats().filter((o) => !o.type.startsWith('pickup')).sort((a, b) => (b.attacking - a.attacking) || (a.dist - b.dist))[0];
    const m = this.input.mouse;
    const aim = t && (t.head || t);
    if (aim) { m.x = aim.x; m.y = aim.y; }
    m.down = !!t;
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Test hooks (headless: ?test)
  testAPI() {
    return {
      game: this,
      start: () => this.startRun(params.get('stage')),
      step: (seconds, dt = 1 / 30) => { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) this.tick(dt); return this.summary(); },
      render: () => { this.renderFrame(); return true; },
      summary: () => this.summary(),
      pick: (i) => this.pick(i),
      setAim: (x, y) => { this.input.mouse.x = x; this.input.mouse.y = y; },
      fire: (on) => { this.input.mouse.down = on; },
      touchState: () => ({ x: this.input.mouse.x, y: this.input.mouse.y, touching: this.input.touching, fire: !!this.touchFire, mode: this.input.touchSettings.mode, target: !!this.weapons.aim.target, ammo: this.weapons.ammo }),
      key: (code, on) => { if (on) this.input.keys.add(code); else this.input.keys.delete(code); },
      /** On-screen threats for bots: [{ x, y (px), head {x,y}, state, attacking, type, dist, boss }] */
      threats: () => this.threats()
    };
  }

  threats() {
    const W = window.innerWidth, H = window.innerHeight;
    const out = [];
    const cam = this.cam.camera;
    const px = (x, y, z) => { _v.set(x, y, z).project(cam); return _v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1 ? { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H } : null; };
    for (const e of this.enemies.list) {
      if (e.ghost || e.state === 'dying' || e.state === 'launched') continue;
      const b = e.boss ? px(this.boss.collar.x, this.boss.collar.y, this.boss.collar.z) : px(e.bx, e.by, e.bz);
      if (!b) continue;
      const h = e.boss ? b : px(e.hx, e.hy, e.hz);
      out.push({ x: b.x, y: b.y, head: h, type: e.type, state: e.boss ? e.mode : e.state, attacking: e.boss ? this.boss._telegraphing(e) : e.state === 'windup' || e.state === 'leap' || e.state === 'charge' || e.state === 'dive', dist: Math.hypot(e.x - this.player.x, e.z - this.player.z), boss: !!e.boss, hp: e.hp });
    }
    for (const w of this.boss.wrecks) { const b = px(w.x, w.y, w.z); if (b) out.push({ x: b.x, y: b.y, head: b, type: 'wreck', attacking: true, dist: Math.hypot(w.x - this.player.x, w.z - this.player.z) }); }
    for (const it of this.pickups.items) { if (!it.float || it.pull) continue; const b = px(it.x, it.y + 0.5, it.z); if (b) out.push({ x: b.x, y: b.y, head: b, type: 'pickup:' + it.type, attacking: false, dist: Math.hypot(it.x - this.player.x, it.z - this.player.z) }); }
    return out;
  }

  summary() {
    return {
      state: this.state, time: +this.director.time.toFixed(1), beat: this.director.beat?.id, level: this.level, score: this.score, kills: this.stats.kills,
      enemies: this.enemies.threatCount, attackers: this.enemies.attackers, hp: Math.round(this.player.hp), ammo: this.weapons.ammo, continues: this.stats.continues,
      boss: this.boss.e && this.boss.active ? { mode: this.boss.e.mode, hp: Math.round(this.boss.e.hp), phase: this.boss.e.phase } : null,
      build: this.weapons.buildList().map((b) => `${b.id}:${b.level}`).join(' '), choices: this.choices?.map((c) => `${c.kind}:${c.id}`)
    };
  }
}

const game = new Game();
window.__game = game.testAPI();
document.getElementById('btn-retry')?.addEventListener('click', () => location.replace(retryURL(location.href)));
// Uncaught errors while loading (or repeatedly during the intro, where the frame loop keeps throwing) end on the error
// screen instead of a black or frozen view
let introErrors = 0;
const onUncaught = (err) => {
  if (game.state === 'loading') game.fatal(`Could not start: ${err?.message || err}`, err);
  else if (game.state === 'intro' && ++introErrors >= 3) game.fatal(`Something went wrong: ${err?.message || err}`, err);
};
window.addEventListener('error', (e) => onUncaught(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => onUncaught(e.reason));
game.init().catch((err) => {
  game.fatal(`Could not start: ${err?.message || err}. Try a recent Chrome, Edge or Safari (WebGPU / WebGL2).`, err);
});
