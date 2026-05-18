/* ═══════════════ COMBAT MULTI-JOUEURS ═══════════════ */

/* ── État global ── */
const players = [];   // [{ slot, pseudo, char, hp, maxHP, alive, team }]
let myChar    = null;
let rematchAsked = false;

const gs = {
  phase: 'select',   // 'select' | 'resolve' | 'over'
  choices: {},       // { slot: { move, targetSlot } }
  charChoices: {},   // { slot: charName }
  pseudos: {},       // { slot: pseudo }
  myAnim: null, theirAnim: null
};

/* ── Connexion ── */
function onConnected() {}  // géré par network.js (onAllConnected)

function onDisconnected() {
  if (gs.phase !== 'over') addLog('⚠️ Connexion perdue.', 'system');
}

function onMessage(msg) {
  switch (msg.type) {
    case 'room_info':    handleRoomInfo(msg);        break;
    case 'pseudo':       handlePseudo(msg);           break;
    case 'char_choice':  handleCharChoice(msg);       break;
    case 'action':       handleAction(msg);           break;
    case 'chat':         addChatMsg(msg.text, false, msg._from); break;
    case 'rematch_ask':  handleRematchAsk(msg);       break;
    case 'rematch_go':   startRematch();              break;
  }
}

function handleRoomInfo(msg) {
  currentMode  = msg.mode;
  teamHPMode   = msg.teamHPMode || 'individual';
  numPlayers   = msg.numPlayers;
}

function handlePseudo(msg) {
  gs.pseudos[msg.slot] = msg.name;
  // Renvoie le nôtre
  send({ type: 'pseudo', name: myPseudo || 'Joueur', slot: mySlot });
  updateAllSprites();
}

/* ── Char select ── */
function handleCharChoice(msg) {
  gs.charChoices[msg.slot] = msg.charName;
  const ready = Object.keys(gs.charChoices).length >= numPlayers;
  if (ready && (isHost || Object.keys(gs.charChoices).length === numPlayers)) {
    startBattle();
  } else {
    const n = Object.keys(gs.charChoices).length;
    document.getElementById('char-select-status').textContent =
      `${n}/${numPlayers} joueurs prêts…`;
  }
}

function selectChar(charName) {
  gs.charChoices[mySlot] = charName;
  document.querySelectorAll('.char-card').forEach(c => {
    c.style.borderColor = c.dataset.char === charName ? CHARS[charName].colorHex : 'var(--border)';
  });
  document.getElementById('char-select-status').textContent =
    `Tu as choisi ${CHARS[charName].icon} ${charName} — en attente des autres…`;

  // Broadcast à tous
  const msg = { type: 'char_choice', slot: mySlot, charName };
  if (isHost) broadcast(msg);
  else        sendTo(0, msg);

  const ready = Object.keys(gs.charChoices).length >= numPlayers;
  if (ready) startBattle();
}

/* ── Init bataille ── */
function startBattle() {
  document.getElementById('char-select').style.display = 'none';
  document.getElementById('battle-area').style.display = 'flex';
  gs.phase   = 'select';
  gs.choices = {};

  // Construit la liste des joueurs
  players.length = 0;
  const n = numPlayers;
  for (let i = 0; i < n; i++) {
    const charName = gs.charChoices[i] || 'Pyros';
    const char     = CHARS[charName];
    let team = null;
    if (currentMode === '2v2') team = i < 2 ? 0 : 1;
    players.push({
      slot: i,
      pseudo: gs.pseudos[i] || `Joueur ${i+1}`,
      char, hp: char.maxHP, maxHP: char.maxHP,
      alive: true, team
    });
    if (i === mySlot) myChar = char;
  }

  // PV partagés en 2v2
  if (currentMode === '2v2' && teamHPMode === 'shared') {
    const teamHP = [0, 1].map(t => {
      const members = players.filter(p => p.team === t);
      return members.reduce((s, p) => s + p.maxHP, 0) / members.length;
    });
    players.forEach(p => { p.maxHP = teamHP[p.team]; p.hp = teamHP[p.team]; });
  }

  if (!r3) initThree();
  else     resetThreeChars();

  renderActionPanel();
  addLog('Que le combat commence !', 'system');
}

/* ── Panneau d'actions ── */
function renderActionPanel() {
  if (!myChar) return;
  const grid = document.getElementById('actions-grid');
  grid.innerHTML = '';

  // Boutons d'attaque
  myChar.moves.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.innerHTML = `${m.icon} ${m.name} <span class="dmg">${m.desc}</span>`;
    btn.onclick = () => openTargetPicker(m);
    grid.appendChild(btn);
  });

  document.getElementById('waiting-action').style.display = 'none';
  document.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
}

/* ── Choix de cible (FFA & 2v2) ── */
function openTargetPicker(move) {
  if (gs.choices[mySlot] || gs.phase !== 'select') return;

  // En 1v1 pas besoin de picker
  if (currentMode === '1v1') {
    const targetSlot = players.find(p => p.slot !== mySlot && p.alive)?.slot ?? -1;
    submitAction(move, targetSlot);
    return;
  }

  // Affiche le picker de cible
  const picker = document.getElementById('target-picker');
  picker.innerHTML = '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em">Choisir une cible</div>';

  const enemies = players.filter(p => {
    if (!p.alive || p.slot === mySlot) return false;
    if (currentMode === '2v2') {
      const me = players[mySlot];
      return p.team !== me.team;
    }
    return true;
  });

  if (move.heal) {
    // Soin : cible un allié (ou soi-même)
    const allies = players.filter(p => {
      if (!p.alive) return false;
      if (currentMode === '2v2') return p.team === players[mySlot].team;
      return p.slot === mySlot;
    });
    allies.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.style.borderColor = SLOT_COLORS[p.slot];
      btn.innerHTML = `${p.pseudo} <span style="font-size:11px;color:var(--muted)">${p.hp}/${p.maxHP} PV</span>`;
      btn.onclick = () => { closePicker(); submitAction(move, p.slot); };
      picker.appendChild(btn);
    });
  } else {
    enemies.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.style.borderColor = SLOT_COLORS[p.slot];
      btn.innerHTML = `${p.pseudo} <span style="font-size:11px;color:var(--muted)">${p.hp}/${p.maxHP} PV</span>`;
      btn.onclick = () => { closePicker(); submitAction(move, p.slot); };
      picker.appendChild(btn);
    });
  }

  picker.style.display = 'flex';
}

function closePicker() {
  document.getElementById('target-picker').style.display = 'none';
}

function submitAction(move, targetSlot) {
  if (gs.choices[mySlot]) return;
  gs.choices[mySlot] = { move, targetSlot };

  document.querySelectorAll('.action-btn').forEach(b => b.disabled = true);
  document.getElementById('waiting-action').style.display = 'block';
  addLog(`Tu choisis ${move.icon} ${move.name}…`, 'me');

  const msg = { type: 'action', slot: mySlot, move, targetSlot };
  if (isHost) {
    broadcast(msg);
    checkAllChosen();
  } else {
    sendTo(0, msg);
  }
}

function handleAction(msg) {
  gs.choices[msg.slot] = { move: msg.move, targetSlot: msg.targetSlot };
  if (isHost) checkAllChosen();
}

function checkAllChosen() {
  if (!isHost) return;
  const alive = players.filter(p => p.alive).length;
  if (Object.keys(gs.choices).length < alive) return;
  resolveRound();
}

/* ── Résolution du round ── */
async function resolveRound() {
  if (!isHost || gs.phase === 'resolve') return;
  gs.phase = 'resolve';

  // Calcule les hits aléatoires
  const results = {};
  Object.entries(gs.choices).forEach(([slot, choice]) => {
    const hit = choice.move.heal ? true : Math.random() < choice.move.acc;
    results[slot] = { ...choice, hit };
  });

  // Broadcast le résultat à tous
  const roundMsg = { type: 'round_result', results };
  broadcast(roundMsg);
  await applyRound(results);
}

// Reçoit le résultat de l'hôte (guests)
function handleRoundResult(msg) {
  applyRound(msg.results);
}

async function applyRound(results) {
  gs.phase = 'resolve';
  document.getElementById('waiting-action').style.display = 'none';

  // Trier par vitesse décroissante
  const order = Object.entries(results)
    .map(([slot, r]) => ({ slot: parseInt(slot), ...r }))
    .sort((a, b) => {
      const sa = players[a.slot]?.char.speed || 0;
      const sb = players[b.slot]?.char.speed || 0;
      return sb - sa;
    });

  for (const action of order) {
    const attacker = players[action.slot];
    const target   = players[action.targetSlot];
    if (!attacker || !attacker.alive) continue;

    await applyAction(attacker, target, action.move, action.hit);
    await delay(500);

    if (checkGameOver()) return;
  }

  // Round terminé
  gs.choices = {};
  gs.phase   = 'select';
  renderActionPanel();
  addLog('— Nouveau round —', 'system');
}

async function applyAction(attacker, target, move, hit) {
  if (!target) return;
  const isMe       = attacker.slot === mySlot;
  const targetIsMe = target.slot === mySlot;
  const aName = attacker.pseudo;
  const tName = target.pseudo;

  if (move.heal) {
    const gain = Math.min(move.heal, target.maxHP - target.hp);
    target.hp = Math.min(target.maxHP, target.hp + gain);
    addLog(`${aName} soigne ${tName} de ${gain} PV !`, isMe ? 'me' : 'them');
    if (targetIsMe) gs.myAnim = { t: 0 };
  } else if (hit) {
    target.hp = Math.max(0, target.hp - move.dmg);
    addLog(`${aName} utilise ${move.icon} ${move.name} sur ${tName} — ${move.dmg} dégâts !`, isMe ? 'me' : 'them');
    if (isMe) {
      spawnHitParticles(target.slot);
    } else if (targetIsMe) {
      gs.theirAnim = { t: 0, slot: attacker.slot };
      spawnHitParticles(mySlot);
    }
  } else {
    addLog(`${aName} utilise ${move.icon} ${move.name}… mais rate !`, isMe ? 'me' : 'them');
  }

  if (target.hp <= 0) target.alive = false;
  updateAllSprites();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Fin de partie ── */
function checkGameOver() {
  if (currentMode === '1v1') {
    const alive = players.filter(p => p.alive);
    if (alive.length <= 1) {
      const winner = alive[0];
      const iWon = winner && winner.slot === mySlot;
      showOverlay(iWon ? '🏆 Victoire !\nTu as gagné !' : '💀 Défaite…\nTu as perdu.');
      gs.phase = 'over';
      return true;
    }
  }

  if (currentMode === 'ffa') {
    const alive = players.filter(p => p.alive);
    if (alive.length <= 1) {
      const winner = alive[0];
      const iWon = winner && winner.slot === mySlot;
      showOverlay(iWon ? `🏆 Victoire !\n${winner.pseudo} gagne !` : `💀 ${alive[0]?.pseudo || '???'} gagne !`);
      gs.phase = 'over';
      return true;
    }
  }

  if (currentMode === '2v2') {
    const me = players[mySlot];
    const myTeam    = players.filter(p => p.team === me.team && p.alive);
    const theirTeam = players.filter(p => p.team !== me.team && p.alive);
    if (myTeam.length === 0) {
      showOverlay('💀 Défaite…\nVotre équipe a perdu !'); gs.phase = 'over'; return true;
    }
    if (theirTeam.length === 0) {
      showOverlay('🏆 Victoire !\nVotre équipe gagne !'); gs.phase = 'over'; return true;
    }
  }

  return false;
}

function showOverlay(text) {
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('overlay-text').textContent = text;
}

/* ── Log & UI ── */
function setLog(text, isEnemy) { addLog(text, isEnemy ? 'them' : 'me'); }

function addLog(text, type = 'system') {
  const box = document.getElementById('combat-log-messages');
  if (!box) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + type;
  const badge = document.createElement('span');
  badge.className = 'log-badge';
  badge.textContent = type === 'me' ? 'Toi' : type === 'them' ? 'Ennemi' : '•';
  const txt = document.createElement('span');
  txt.className = 'log-text';
  txt.textContent = text;
  entry.appendChild(badge);
  entry.appendChild(txt);
  box.appendChild(entry);
  box.scrollTop = box.scrollHeight;
}

/* ── Rematch ── */
function askRematch() {
  if (rematchAsked) return;
  rematchAsked = true;
  const btn = document.querySelector('#overlay .btn');
  btn.textContent = '⏳ En attente…';
  btn.disabled = true;
  btn.onclick = null;
  send({ type: 'rematch_ask', slot: mySlot });
}

function handleRematchAsk(msg) {
  if (rematchAsked) {
    send({ type: 'rematch_go' });
    startRematch();
  } else {
    document.querySelector('#overlay-text').textContent += '\n\nUn adversaire veut rejouer !';
    const btn = document.querySelector('#overlay .btn');
    btn.textContent = '✅ Accepter';
    btn.disabled = false;
    btn.onclick = () => { rematchAsked = true; send({ type: 'rematch_go' }); startRematch(); };
  }
}

function startRematch() {
  rematchAsked = false;
  document.getElementById('overlay').style.display = 'none';
  const btn = document.querySelector('#overlay .btn');
  btn.textContent = '↺ Rejouer'; btn.disabled = false; btn.onclick = askRematch;

  gs.choices = {}; gs.charChoices = {}; gs.phase = 'select';
  players.length = 0;

  const box = document.getElementById('combat-log-messages');
  if (box && box.children.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'log-entry system';
    sep.innerHTML = '<span class="log-badge">•</span><span class="log-text" style="color:var(--muted)">── Nouvelle partie ──</span>';
    box.appendChild(sep);
  }

  showCharSelect();
}

// Intégration message round_result côté guest
const _origOnMessage = onMessage;
window._onMessage = function(msg) {
  if (msg.type === 'round_result' && !isHost) {
    applyRound(msg.results);
    return;
  }
  _origOnMessage(msg);
};
