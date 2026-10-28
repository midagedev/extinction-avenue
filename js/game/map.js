import { GEO } from '../nyc-geodata.js';
import { STAGES } from './stages.js';
import { isUnlocked, totalStars } from './campaign.js';

// js/game/map.js
// Outbreak map. A flat poster of Manhattan (real outline, real corners) with one fat touch target per
// sector. The picture is fitted, not a free camera, so portrait Safari can run a thumb down the list
// and hit DEPLOY without a pinch-zoom.

const VIEW = { minX: -1250, maxX: 850, minZ: -2300, maxZ: 1750 };
const VW = 1000;
const VH = 1500;

function project(x, z) {
  return [
    ((x - VIEW.minX) / (VIEW.maxX - VIEW.minX)) * VW,
    ((z - VIEW.minZ) / (VIEW.maxZ - VIEW.minZ)) * VH
  ];
}

function islandPath() {
  const m = GEO.manhattan;
  let d = '';
  const step = 8;
  for (let i = 0; i < m.length; i += step * 2) {
    const [x, y] = project(m[i], m[i + 1]);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d + 'Z';
}

let ISLAND = '';

class MapScreen {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.root = document.getElementById('s-map');
    this.pins = document.getElementById('map-pins');
    this.svg = document.getElementById('map-svg');
    this._built = false;
  }

  _ensure() {
    if (this._built || !this.svg) return;
    this._built = true;
    if (!ISLAND) ISLAND = islandPath();
    const park = GEO.centralPark.bounds;
    const [px0, py0] = project(park.minX, park.minZ);
    const [px1, py1] = project(park.maxX, park.maxZ);
    const roads = [];
    for (const x of [-859.7, -584.8, -310.3, 0.4, 311, 467]) {
      const [a] = project(x, VIEW.minZ);
      roads.push(`<line x1="${a.toFixed(1)}" y1="0" x2="${a.toFixed(1)}" y2="${VH}" />`);
    }
    for (const z of [-1369.9, -1204.3, -403.1, 0.3, 640.5, 1515]) {
      const [, b] = project(0, z);
      roads.push(`<line x1="0" y1="${b.toFixed(1)}" x2="${VW}" y2="${b.toFixed(1)}" />`);
    }
    const label = (x, z, text, anchor = 'middle') => {
      const [sx, sy] = project(x, z);
      return `<text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="${anchor}">${text}</text>`;
    };
    this.svg.innerHTML = `
      <rect class="water" width="${VW}" height="${VH}" />
      <g class="roads">${roads.join('')}</g>
      <path class="island" d="${ISLAND}" />
      <rect class="park" x="${Math.min(px0, px1).toFixed(1)}" y="${Math.min(py0, py1).toFixed(1)}" width="${Math.abs(px1 - px0).toFixed(1)}" height="${Math.abs(py1 - py0).toFixed(1)}" />
      <g class="map-labels">
        ${label(-1180, 400, 'HUDSON', 'start')}
        ${label(780, -1100, 'EAST RIVER', 'end')}
        ${label(-420, -1800, 'CENTRAL PARK')}
        ${label(-200, 1500, 'DOWNTOWN')}
      </g>`;
    this.pins.innerHTML = '';
    STAGES.forEach((stage, i) => {
      const [x, y] = project(stage.marker.x, stage.marker.z);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin' + (stage.finale === 'trex' ? ' apex' : '');
      b.style.left = `${(x / VW) * 100}%`;
      b.style.top = `${(y / VH) * 100}%`;
      b.dataset.i = String(i);
      b.innerHTML = `<i></i><b></b><span></span>`;
      b.addEventListener('click', () => { this.game.audio?.play('ui'); this.select(i); });
      this.pins.appendChild(b);
    });
  }

  /** First unlocked sector that isn't cleared, else the latest open one. */
  _defaultIndex() {
    const p = this.game.progress;
    let open = 0;
    for (let i = 0; i < STAGES.length; i++) {
      if (!isUnlocked(p, STAGES, i)) break;
      open = i;
      if (!(p.stages[STAGES[i].id]?.clears)) return i;
    }
    return open;
  }

  refresh() {
    this._ensure();
    this.select(this._defaultIndex(), false);
  }

  select(index, sound = true) {
    this._ensure();
    this.index = Math.max(0, Math.min(STAGES.length - 1, index));
    const stage = STAGES[this.index];
    const p = this.game.progress;
    const unlocked = isUnlocked(p, STAGES, this.index);
    const rec = p.stages[stage.id] || { best: 0, stars: 0, clears: 0 };
    const pins = this.pins.children;
    for (let i = 0; i < pins.length; i++) {
      const s = STAGES[i];
      const on = isUnlocked(p, STAGES, i);
      const r = p.stages[s.id];
      pins[i].classList.toggle('on', i === this.index);
      pins[i].classList.toggle('locked', !on);
      pins[i].classList.toggle('done', !!(r && r.clears));
      pins[i].querySelector('b').textContent = on ? String(i + 1) : '';
      pins[i].querySelector('span').textContent = s.finale === 'trex' ? 'APEX' : s.name.split(' ')[0];
      pins[i].setAttribute('aria-label', `${s.name}${on ? '' : ', locked'}`);
    }
    const $ = (id) => document.getElementById(id);
    $('map-kicker').textContent = stage.kicker;
    $('map-name').textContent = stage.name;
    $('map-place').textContent = stage.place;
    $('map-blurb').textContent = unlocked ? stage.blurb : 'Clear the previous sector to open this street.';
    $('map-obj').textContent = stage.objective;
    const stars = rec.stars || 0;
    $('map-stars').textContent = unlocked ? ('★'.repeat(stars) + '☆'.repeat(3 - stars)) : 'LOCKED';
    $('map-best').textContent = rec.best ? `BEST ${rec.best.toLocaleString('en-US')}` : '';
    const go = $('btn-deploy');
    go.textContent = unlocked ? `DEPLOY · ${stage.name}` : 'LOCKED';
    go.classList.toggle('locked', !unlocked);
    const total = totalStars(p);
    $('map-score').textContent = total ? `${total} / ${STAGES.length * 3} STARS` : 'CLEAR THEM IN ORDER';
    void sound;
  }

  deploy() {
    const stage = STAGES[this.index];
    if (!isUnlocked(this.game.progress, STAGES, this.index)) {
      this.root?.querySelector('.map-sheet')?.classList.add('shake');
      setTimeout(() => this.root?.querySelector('.map-sheet')?.classList.remove('shake'), 450);
      this.game.audio?.play('ui_back');
      return;
    }
    this.game.audio?.play('ui');
    this.game.startRun(stage.id);
  }
}

export { MapScreen, STAGES };
