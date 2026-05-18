'use strict';
/* ═══════════════ CONFIG ═══════════════ */
const SIGNAL = 'https://battle-arena-server-t781.onrender.com';

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

/* Modes disponibles selon nb de joueurs */
const MODES_BY_COUNT = {
  2: [{ id:'1v1', label:'1 vs 1',       icon:'⚔️'  }],
  3: [{ id:'ffa', label:'Free For All', icon:'💥'  }],
  4: [{ id:'ffa', label:'Free For All', icon:'💥'  },
      { id:'2v2', label:'2 vs 2',       icon:'🛡️' }]
};

const CHARS = {
  Pyros: {
    name:'Pyros', icon:'⚔️', colorHex:'#ff5522', color3D:0xff5522,
    maxHP:90, speed:80,
    moves:[
      {name:'Flamme',  icon:'🔥',dmg:18,acc:.95,desc:'18·95%'},
      {name:'Inferno', icon:'💥',dmg:38,acc:.60,desc:'38·60%'},
      {name:'Brûlure', icon:'🌋',dmg:12,acc:1,  desc:'12·100%'},
      {name:'Soin',    icon:'💚',dmg:0, acc:1,  heal:20,desc:'+20 PV'},
    ]
  },
  Glacius: {
    name:'Glacius', icon:'🧊', colorHex:'#22aaff', color3D:0x22aaff,
    maxHP:110, speed:40,
    moves:[
      {name:'Blizzard',   icon:'❄️',dmg:22,acc:.90,desc:'22·90%'},
      {name:'Avalanche',  icon:'🌀',dmg:45,acc:.55,desc:'45·55%'},
      {name:'Stalactite', icon:'🧊',dmg:14,acc:1,  desc:'14·100%'},
      {name:'Soin',       icon:'💚',dmg:0, acc:1,  heal:25,desc:'+25 PV'},
    ]
  }
};

/* Couleurs des slots (jusqu'à 4) */
const SLOT_CLR    = ['#ff5522','#ff9900','#22aaff','#00ddaa'];
const SLOT_CLR_3D = [0xff5522, 0xff9900, 0x22aaff, 0x00ddaa];

/* Positions 3D selon nb de joueurs */
const POS = {
  2: [[-2.2,0,0],[2.2,0,0]],
  3: [[-2.8,0,0],[0,0,-0.8],[2.8,0,0]],
  4: [[-3.0,0,0.6],[-1.0,0,-0.6],[1.0,0,-0.6],[3.0,0,0.6]]
};

/* État global partagé */
const G = {
  myToken   : localStorage.getItem('ba_token') || null,
  myProfile : null,
  myPseudo  : null,
  isHost    : false,
  roomId    : '',
  mySlot    : 0,
  mode      : '1v1',
  teamHPMode: 'individual',
  /* Lobby */
  lobbyPlayers: [],   // [{slot,pseudo,avatar,ready}]
  /* Combat */
  players  : [],      // [{slot,pseudo,char,hp,maxHP,alive,team}]
  choices  : {},      // {slot:{move,targetSlot}}
  phase    : 'lobby', // lobby|charselect|fight|over
};
