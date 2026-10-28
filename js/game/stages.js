// js/game/stages.js
// The outbreak map. Every sector is a short scripted run that STARTS at a real Manhattan corner on the
// existing midtown patrol (route.js LOOP: 5th Ave, 34th, 7th Ave, 57th). The cab never leaves that loop,
// so the phone's city window does not grow — Times Square, the Empire State corner, Herald Square,
// 50th & Fifth (Radio City is the next avenue), 57th along the park, and 42nd (Grand Central is two
// blocks east) are all on it. The last sector is the multi-phase T. rex chase.
//
// Each sector is about a minute and a half to three minutes. A 'whoa' op fires inside the first ~20 s
// and again at the finale. Beats use the same program as director.js.

const WHOA_OPS = new Set(['burst', 'grate', 'snatch', 'herd', 'chain', 'collapse']);

function B(id, dur, speed, o, prog) {
  const b = {
    id, dur, speed,
    cap: o.cap ?? 8,
    min: o.min ?? 0,
    atk: o.atk ?? 2,
    wind: o.wind ?? 1.32,
    label: o.label || null,
    prog
  };
  if (o.zone) b.zone = true;
  if (o.boss) b.boss = true;
  if (o.minDur) b.minDur = o.minDur;
  if (o.trickle) b.trickle = o.trickle;
  return b;
}

const STAGES = [
  {
    id: 'times',
    name: 'TIMES SQUARE',
    kicker: 'SECTOR 01',
    place: '7th Ave & 42nd',
    blurb: 'The bowtie is a killbox. They come through the glass, then the cars go up.',
    objective: 'Hold the square. Drop the Alpha Ravager.',
    startS: 2920,
    par: 130,
    marker: { x: -561, z: -35 },
    finale: 'clear',
    beats: [
      B('ts-intro', 8, 13, { cap: 4, atk: 0, wind: 1.6 }, [
        [0.35, 'title', 'SECTOR 01', 'TIMES SQUARE', '7th Avenue · 42nd Street']
      ]),
      B('ts-breach', 18, 11, { cap: 10, min: 3, atk: 1, wind: 1.45, label: ['THROUGH THE GLASS', 'Storefronts on both sides'] }, [
        [0.3, 'clip', 'whoa'],
        [1.1, 'burst', 'storeL', 3],
        [4.2, 'chain'],
        [7.5, 'burst', 'storeR', 3],
        [12, 'spawn', 'raptor', 2, 'behind']
      ]),
      B('ts-chase', 24, 17, { cap: 10, min: 4, atk: 2, wind: 1.35, label: ['AVENUE CHASE', 'Don\'t let them on the bumper'], trickle: { raptor: 0.28, compy: 0.2 } }, [
        [6, 'spawn', 'ptero', 2, 'sky'],
        [6, 'look', 0, 0.2, 3],
        [14, 'spawn', 'brute', 1, 'behind'],
        [16, 'punch', 0.3, 2.5, 0.03]
      ]),
      B('ts-zone', 32, 0, { zone: true, minDur: 16, cap: 12, min: 4, atk: 2, wind: 1.3, label: ['COMBAT ZONE', 'Hold the intersection'] }, [
        [1, 'spawn', 'compy', 4, 'behind'],
        [6, 'ambush', 'left', [['raptor', 3], ['compy', 2]]],
        [14, 'ambush', 'right', [['raptor', 2], ['compy', 2]]],
        [20, 'drop', 'repair']
      ]),
      B('ts-alpha', 40, 14, { boss: true, minDur: 14, cap: 8, min: 2, atk: 2, wind: 1.25 }, [
        [0.4, 'clip', 'finale'],
        [0.6, 'miniboss', 'brute', 'alpha', 'ALPHA RAVAGER', 'Pack leader · howls the square down on you'],
        [2, 'spawn', 'raptor', 2, 'behind'],
        [8, 'chain']
      ])
    ]
  },
  {
    id: 'empire',
    name: 'EMPIRE STATE',
    kicker: 'SECTOR 02',
    place: '5th Ave & 34th',
    blurb: 'A herd owns Fifth. You are the brake lights they are running down.',
    objective: 'Survive the stampede. Stop the Hornwall.',
    startS: 1680,
    par: 125,
    marker: { x: -80, z: 686 },
    finale: 'clear',
    beats: [
      B('es-intro', 8, 15, { cap: 4, atk: 0, wind: 1.55 }, [
        [0.35, 'title', 'SECTOR 02', 'EMPIRE STATE', 'Fifth Avenue, running downtown']
      ]),
      B('es-herd', 18, 16, { cap: 14, min: 6, atk: 2, wind: 1.4, label: ['STAMPEDE', 'They\'re pouring down Fifth'] }, [
        [0.3, 'clip', 'whoa'],
        [1.0, 'herd', 8],
        [5.5, 'chain'],
        [9, 'spawn', 'raptor', 2, 'behind']
      ]),
      B('es-chase', 22, 18, { cap: 10, min: 4, atk: 2, wind: 1.32, label: ['FLOOR IT', 'The tower is ahead — you watch the street'], trickle: { compy: 0.35, raptor: 0.25 } }, [
        [8, 'spawn', 'trike', 1, 'behind'],
        [8, 'punch', 0.35, 3, 0.04],
        [14, 'drop', 'overdrive']
      ]),
      B('es-zone', 28, 0, { zone: true, minDur: 14, cap: 12, min: 4, atk: 2, wind: 1.28, label: ['COMBAT ZONE', '34th Street — hold the corner'] }, [
        [1, 'spawn', 'raptor', 3, 'behind'],
        [6, 'ambush', 'left', [['compy', 4], ['raptor', 2]]],
        [14, 'spawn', 'brute', 1, 'behind']
      ]),
      B('es-horn', 40, 15, { boss: true, minDur: 14, cap: 8, min: 2, atk: 2, wind: 1.22 }, [
        [0.4, 'clip', 'finale'],
        [0.6, 'miniboss', 'trike', null, 'HORNWALL MATRIARCH', 'She charges the lane · shoot her face'],
        [3, 'chain']
      ])
    ]
  },
  {
    id: 'herald',
    name: 'HERALD SQUARE',
    kicker: 'SECTOR 03',
    place: '34th & Broadway',
    blurb: 'Macy\'s block. Both sidewalks empty at once, then the iron comes.',
    objective: 'Clear the crossfire. Break the Irontail.',
    startS: 2140,
    par: 120,
    marker: { x: -461, z: 595 },
    finale: 'clear',
    beats: [
      B('hd-intro', 8, 13, { cap: 3, atk: 0, wind: 1.55 }, [
        [0.35, 'title', 'SECTOR 03', 'HERALD SQUARE', '34th Street · Macy\'s']
      ]),
      B('hd-cross', 18, 12, { cap: 12, min: 4, atk: 2, wind: 1.38, label: ['CROSSFIRE', 'Both sidewalks'] }, [
        [0.3, 'clip', 'whoa'],
        [1.2, 'ambush', 'left', [['raptor', 3], ['compy', 2]]],
        [1.3, 'burst', 'storeL', 2],
        [6.5, 'ambush', 'right', [['raptor', 3], ['compy', 2]]],
        [10, 'chain']
      ]),
      B('hd-chase', 20, 16, { cap: 10, min: 3, atk: 2, wind: 1.3, trickle: { raptor: 0.3 } }, [
        [4, 'spawn', 'ptero', 2, 'sky'],
        [4, 'look', 0, 0.18, 3],
        [12, 'drop', 'repair']
      ]),
      B('hd-zone', 26, 0, { zone: true, minDur: 14, cap: 12, min: 4, atk: 2, wind: 1.28, label: ['COMBAT ZONE', 'Don\'t give them the intersection'] }, [
        [1, 'spawn', 'compy', 4, 'behind'],
        [8, 'ambush', 'right', [['raptor', 2], ['brute', 1]]],
        [14, 'spawn', 'raptor', 2, 'storeL']
      ]),
      B('hd-iron', 42, 12, { boss: true, minDur: 14, cap: 8, min: 2, atk: 2, wind: 1.22 }, [
        [0.4, 'clip', 'finale'],
        [0.5, 'collapse'],
        [1.2, 'miniboss', 'ankylo', null, 'IRONTAIL', 'The club tail clears the lane · shoot the head']
      ])
    ]
  },
  {
    id: 'radio',
    name: 'RADIO CITY',
    kicker: 'SECTOR 04',
    place: '50th & Fifth',
    blurb: 'The Lexington grates blow first. Then something takes the marquee with it.',
    objective: 'Seal the grates. Drop the Marquee brute.',
    startS: 500,
    par: 115,
    marker: { x: -222, z: -681 },
    finale: 'clear',
    beats: [
      B('rc-intro', 8, 13, { cap: 3, atk: 0, wind: 1.55 }, [
        [0.35, 'title', 'SECTOR 04', 'RADIO CITY', 'Fifth Avenue · 50th Street']
      ]),
      B('rc-grate', 16, 10, { cap: 10, min: 3, atk: 1, wind: 1.4, label: ['SUBWAY BREACH', 'They\'re coming up through the grates'] }, [
        [0.25, 'clip', 'whoa'],
        [1.0, 'grate'],
        [1.2, 'spawn', 'raptor', 4, 'close'],
        [6, 'burst', 'storeR', 2],
        [9, 'punch', 0.35, 3, 0.04]
      ]),
      B('rc-sky', 16, 14, { cap: 8, min: 2, atk: 2, wind: 1.32, label: ['EYES UP', 'Two of them, low'] }, [
        [0.6, 'spawn', 'ptero', 2, 'sky'],
        [0.6, 'look', 0, 0.28, 4],
        [8, 'spawn', 'ptero', 1, 'sky']
      ]),
      B('rc-chase', 18, 16, { cap: 9, min: 3, atk: 2, wind: 1.28, trickle: { raptor: 0.25, compy: 0.2 } }, [
        [6, 'spawn', 'raptor', 2, 'behind'],
        [12, 'drop', 'airstrike']
      ]),
      B('rc-marquee', 40, 11, { boss: true, minDur: 14, cap: 8, min: 2, atk: 2, wind: 1.2 }, [
        [0.35, 'clip', 'finale'],
        [0.45, 'collapse'],
        [1.3, 'miniboss', 'brute', null, 'MARQUEE', 'She comes through the scaffolding']
      ])
    ]
  },
  {
    id: 'park',
    name: 'PARK SOUTH',
    kicker: 'SECTOR 05',
    place: 'Central Park South',
    blurb: 'One block off the park. They take the cars first, then they take the sky.',
    objective: 'Keep the cab. Shoot the Skyreaver down.',
    startS: 4480,
    par: 115,
    marker: { x: -420, z: -1370 },
    finale: 'clear',
    beats: [
      B('pk-intro', 8, 14, { cap: 3, atk: 0, wind: 1.55 }, [
        [0.35, 'title', 'SECTOR 05', 'PARK SOUTH', '57th Street · Central Park']
      ]),
      B('pk-snatch', 16, 15, { cap: 8, min: 2, atk: 1, wind: 1.4, label: ['INCOMING', 'They hunt from the tree line'] }, [
        [0.25, 'clip', 'whoa'],
        [1.0, 'snatch'],
        [1.1, 'spawn', 'ptero', 2, 'sky'],
        [6, 'spawn', 'ptero', 1, 'sky'],
        [8, 'punch', 0.3, 2, 0.03]
      ]),
      B('pk-flock', 20, 14, { cap: 9, min: 3, atk: 2, wind: 1.3, label: ['SKY RAID', 'A short flock, not a cloud'] }, [
        [0.5, 'spawn', 'ptero', 3, 'sky'],
        [0.5, 'look', 0, 0.24, 5],
        [10, 'spawn', 'raptor', 2, 'behind'],
        [14, 'drop', 'repair']
      ]),
      B('pk-chase', 16, 17, { cap: 8, min: 3, atk: 2, wind: 1.28, trickle: { compy: 0.25 } }, [
        [4, 'spawn', 'raptor', 2, 'left'],
        [9, 'chain']
      ]),
      B('pk-queen', 38, 13, { boss: true, minDur: 12, cap: 8, min: 1, atk: 2, wind: 1.2 }, [
        [0.35, 'clip', 'finale'],
        [0.5, 'look', 0, 0.3, 4],
        [0.7, 'miniboss', 'ptero', null, 'SKYREAVER QUEEN', 'She dives the cab · shoot her off the wind']
      ])
    ]
  },
  {
    id: 'terminal',
    name: 'GRAND CENTRAL',
    kicker: 'SECTOR 06',
    place: '42nd & Park',
    blurb: 'Fifth and 42nd. The terminal is two blocks east and the Lexington line just opened.',
    objective: 'Hold 42nd. Stop the Conductor.',
    startS: 1050,
    par: 120,
    marker: { x: 311, z: -67 },
    finale: 'clear',
    beats: [
      B('gc-intro', 8, 13, { cap: 3, atk: 0, wind: 1.55 }, [
        [0.35, 'title', 'SECTOR 06', 'GRAND CENTRAL', '42nd Street · the Lexington line']
      ]),
      B('gc-grate', 16, 11, { cap: 10, min: 3, atk: 1, wind: 1.4, label: ['LEXINGTON LINE', 'The grates are gone'] }, [
        [0.25, 'clip', 'whoa'],
        [0.9, 'grate'],
        [1.1, 'spawn', 'raptor', 3, 'close'],
        [1.2, 'spawn', 'compy', 3, 'close'],
        [7, 'punch', 0.4, 3.5, 0.05]
      ]),
      B('gc-glass', 16, 12, { cap: 10, min: 3, atk: 2, wind: 1.32, label: ['STOREFRONTS', '42nd gives way'] }, [
        [1, 'burst', 'storeL', 3],
        [5, 'burst', 'storeR', 2],
        [8, 'chain']
      ]),
      B('gc-zone', 28, 0, { zone: true, minDur: 14, cap: 12, min: 4, atk: 2, wind: 1.28, label: ['COMBAT ZONE', 'Hold the corner of Fifth'] }, [
        [1, 'spawn', 'raptor', 3, 'behind'],
        [7, 'ambush', 'right', [['raptor', 3], ['compy', 2]]],
        [14, 'spawn', 'brute', 1, 'behind'],
        [16, 'drop', 'repair']
      ]),
      B('gc-boss', 40, 13, { boss: true, minDur: 14, cap: 8, min: 2, atk: 2, wind: 1.2 }, [
        [0.35, 'clip', 'finale'],
        [0.5, 'chain'],
        [1.1, 'miniboss', 'brute', 'alpha', 'THE CONDUCTOR', 'It came up with the train · the collar still sparks']
      ])
    ]
  },
  {
    id: 'gridlock',
    name: 'GRIDLOCK',
    kicker: 'APEX',
    place: 'Fifth Avenue',
    blurb: 'Containment collar T-01. It runs the avenue, then it comes for the cab.',
    objective: 'Shoot the collar. Three phases. Do not blink.',
    startS: 360,
    par: 150,
    marker: { x: 90, z: -880 },
    finale: 'trex',
    beats: [
      B('gx-intro', 8, 14, { cap: 4, atk: 0, wind: 1.55 }, [
        [0.3, 'title', 'APEX SPECIMEN', 'GRIDLOCK', 'Fifth Avenue · containment failed']
      ]),
      B('gx-rush', 18, 16, { cap: 10, min: 4, atk: 2, wind: 1.35, label: ['THEY KNOW', 'The avenue clears for something bigger'], trickle: { raptor: 0.3, compy: 0.25 } }, [
        [0.4, 'clip', 'whoa'],
        [1.1, 'herd', 6],
        [7, 'spawn', 'brute', 1, 'behind'],
        [11, 'chain']
      ]),
      B('gx-warn', 8, 13, { cap: 6, min: 0, atk: 1, wind: 1.3, label: ['…QUIET', 'Too quiet'] }, [
        [0.6, 'drop', 'repair'],
        [1.2, 'warning'],
        [1.2, 'clip', 'finale']
      ])
    ]
  }
];

function stageById(id) {
  return STAGES.find((s) => s.id === id) || null;
}

function scriptDuration(stage) {
  return stage.beats.reduce((sum, b) => sum + b.dur, 0);
}

/** Seconds from the start of the sector until the first set-piece op. */
function firstWhoa(stage) {
  let t = 0;
  for (const b of stage.beats) {
    for (const step of b.prog) if (WHOA_OPS.has(step[1])) return t + step[0];
    t += b.dur;
  }
  return null;
}

export { STAGES, WHOA_OPS, stageById, scriptDuration, firstWhoa };
