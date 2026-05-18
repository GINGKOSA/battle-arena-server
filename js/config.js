/* ═══════════════ CONFIG ═══════════════ */
const SIGNAL = 'https://battle-arena-server-t781.onrender.com';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

let myPseudo = null;

const MODES = {
  '1v1': { label: '1 vs 1',       icon: '⚔️',  maxPlayers: 2 },
  'ffa': { label: 'Free For All', icon: '💥',  maxPlayers: 4 },
  '2v2': { label: '2 vs 2',       icon: '🛡️', maxPlayers: 4 }
};

let currentMode  = '1v1';
let teamHPMode   = 'individual'; // '2v2' seulement : 'individual' | 'shared'

const CHARS = {
  Pyros: {
    name: 'Pyros', icon: '⚔️',
    color3D: 0xff5522, colorHex: '#ff5522',
    maxHP: 90, speed: 80,
    moves: [
      { name: 'Flamme',  icon: '🔥', dmg: 18, acc: 0.95, desc: '18 dmg · 95%' },
      { name: 'Inferno', icon: '💥', dmg: 38, acc: 0.60, desc: '38 dmg · 60%' },
      { name: 'Brûlure', icon: '🌋', dmg: 12, acc: 1.00, desc: '12 dmg · 100%' },
      { name: 'Soin',    icon: '💚', dmg: 0,  acc: 1.00, heal: 20, desc: '+20 PV' },
    ]
  },
  Glacius: {
    name: 'Glacius', icon: '🧊',
    color3D: 0x22aaff, colorHex: '#22aaff',
    maxHP: 110, speed: 40,
    moves: [
      { name: 'Blizzard',   icon: '❄️', dmg: 22, acc: 0.90, desc: '22 dmg · 90%' },
      { name: 'Avalanche',  icon: '🌀', dmg: 45, acc: 0.55, desc: '45 dmg · 55%' },
      { name: 'Stalactite', icon: '🧊', dmg: 14, acc: 1.00, desc: '14 dmg · 100%' },
      { name: 'Soin',       icon: '💚', dmg: 0,  acc: 1.00, heal: 25, desc: '+25 PV' },
    ]
  }
};

// Positions 3D selon nombre de joueurs
const POSITIONS = {
  2: [[-2.2, 0, 0],  [2.2, 0, 0]],
  4: [[-3.2, 0, 0.8], [-1.2, 0, -0.4], [1.2, 0, -0.4], [3.2, 0, 0.8]]
};

// Équipes en 2v2 : indices des joueurs
const TEAMS_2V2 = [[0, 1], [2, 3]];

// Couleurs des slots joueurs
const SLOT_COLORS = ['#ff5522', '#ff9900', '#22aaff', '#00ddaa'];
const SLOT_COLORS_3D = [0xff5522, 0xff9900, 0x22aaff, 0x00ddaa];
