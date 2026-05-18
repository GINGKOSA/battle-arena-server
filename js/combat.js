/* ═══════════════ GAME STATE ═══════════════ */
let myChar    = null;
let theirChar = null;
let myCharChoice    = null;
let theirCharChoice = null;
let rematchAsked = false;

const gs = {
  myHP: 0, theirHP: 0,
  myMaxHP: 0, theirMaxHP: 0,
  myChoice: null, theirChoice: null,
  busy: false, over: false,
  myAnim: null, theirAnim: null
};

/* ── Connexion établie ── */
function onConnected() {
  if (document.getElementById('game').style.display === 'flex') return;
  stopPolls();
  document.getElementById('waiting-room').style.display = 'none';
  showScreen('game');
  showCharSelect();
}

function onDisconnected() {
  if (!gs.over) addLog('⚠️ Connexion perdue avec l\'adversaire.', 'system');
}

function onMessage(msg) {
  if (msg.type === 'pseudo') {
    theirPseudo = msg.name;
    updateTheirSprite();
    // Renvoie le nôtre au cas où il n'a pas été reçu
    send({ type: 'pseudo', name: myPseudo || 'Joueur' });
  }
  if (msg.type === 'char_choice')  receiveTheirChar(msg.char);
  if (msg.type === 'choice')       receiveTheirChoice(msg.move);
  if (msg.type === 'round_result') applyResult(msg);
  if (msg.type === 'chat')         addChatMsg(msg.text, false);
  if (msg.type === 'rematch_ask') {
    if (rematchAsked) {
      send({ type: 'rematch_go' });
      startRematch();
    } else {
      document.querySelector('#overlay-text').textContent += '\n\nL\'adversaire veut rejouer !';
      const btn = document.querySelector('#overlay .btn');
      btn.textContent = '✅ Accepter la revanche';
      btn.disabled = false;
      btn.onclick = () => {
        rematchAsked = true;
        send({ type: 'rematch_go' });
        startRematch();
      };
    }
  }
  if (msg.type === 'rematch_go') startRematch();
}

/* ── Init état ── */
function initGameState() {
  gs.myHP       = myChar.maxHP;
  gs.theirHP    = theirChar.maxHP;
  gs.myMaxHP    = myChar.maxHP;
  gs.theirMaxHP = theirChar.maxHP;
  gs.myChoice   = null;
  gs.theirChoice= null;
  gs.busy  = false;
  gs.over  = false;
  gs.myAnim    = null;
  gs.theirAnim = null;
}

/* ── Char select ── */
function receiveTheirChar(charName) {
  theirCharChoice = charName;
  if (myCharChoice) startBattle();
  else addLog('L\'adversaire a choisi son personnage — à toi !', 'system');
}

function startBattle() {
  myChar    = CHARS[myCharChoice];
  theirChar = CHARS[theirCharChoice];

  // Pseudos finaux (fallback sur nom du perso)
  if (!myPseudo)    myPseudo    = myChar.name;
  if (!theirPseudo) theirPseudo = theirChar.name;

  document.getElementById('char-select').style.display  = 'none';
  document.getElementById('battle-area').style.display  = 'flex';

  initGameState();
  if (!r3) initThree();
  else     resetThreeChars();

  renderMoves();
  document.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
  document.getElementById('waiting-action').style.display = 'none';
  setLog('Que le combat commence !', false);
}

/* ── Actions ── */
function renderMoves() {
  const grid = document.getElementById('actions-grid');
  grid.innerHTML = '';
  myChar.moves.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.innerHTML = `${m.icon} ${m.name} <span class="dmg">${m.desc}</span>`;
    btn.onclick = () => chooseAction(m);
    grid.appendChild(btn);
  });
}

function chooseAction(move) {
  if (gs.myChoice || gs.busy || gs.over) return;
  gs.myChoice = move;
  document.querySelectorAll('.action-btn').forEach(b => b.disabled = true);
  document.getElementById('waiting-action').style.display = 'block';
  setLog(`Tu choisis ${move.icon} ${move.name} — en attente de l'adversaire…`, false);
  send({ type: 'choice', move });
  if (gs.theirChoice) resolveRound();
}

function receiveTheirChoice(move) {
  gs.theirChoice = move;
  if (gs.myChoice) resolveRound();
  else setLog('L\'adversaire a choisi — à toi !', true);
}

/* ── Round ── */
async function resolveRound() {
  if (gs.busy || gs.over) return;
  gs.busy = true;
  document.getElementById('waiting-action').style.display = 'none';

  const myMove    = gs.myChoice;
  const theirMove = gs.theirChoice;
  gs.myChoice    = null;
  gs.theirChoice = null;

  if (isHost) {
    const myHit    = myMove.heal    ? true : Math.random() < myMove.acc;
    const theirHit = theirMove.heal ? true : Math.random() < theirMove.acc;
    const result = { type: 'round_result', myMove, theirMove, myHit, theirHit };
    send(result);
    await applyResult(result);
  }
}

async function applyResult(result) {
  const hostMove  = result.myMove;
  const guestMove = result.theirMove;
  const hostHit   = result.myHit;
  const guestHit  = result.theirHit;

  // Pyros (hôte vitesse 80) toujours plus rapide que Glacius (40)
  // Mais si même perso, l'hôte frappe en premier
  const hostChar  = isHost ? myChar    : theirChar;
  const guestChar = isHost ? theirChar : myChar;
  const hostFaster = hostChar.speed >= guestChar.speed;

  if (hostFaster) {
    await applyMoveResult(hostMove,  hostHit,  isHost ? 'me' : 'them');
    if (gs.over) return;
    await delay(700);
    await applyMoveResult(guestMove, guestHit, isHost ? 'them' : 'me');
  } else {
    await applyMoveResult(guestMove, guestHit, isHost ? 'them' : 'me');
    if (gs.over) return;
    await delay(700);
    await applyMoveResult(hostMove,  hostHit,  isHost ? 'me' : 'them');
  }

  if (!gs.over) {
    gs.busy = false;
    renderMoves();
    document.querySelectorAll('.action-btn').forEach(b => b.disabled = false);
    setLog('Choisis ton attaque !', false);
  }
}

async function applyMoveResult(move, hit, who) {
  const isMe = who === 'me';
  const myName    = myPseudo    || myChar.name;
  const theirName = theirPseudo || theirChar.name;

  if (move.heal) {
    const gain = move.heal;
    if (isMe) {
      gs.myHP = Math.min(gs.myMaxHP, gs.myHP + gain);
      setLog(`${myName} utilise ${move.icon} ${move.name} et récupère ${gain} PV !`, false);
    } else {
      gs.theirHP = Math.min(gs.theirMaxHP, gs.theirHP + gain);
      setLog(`${theirName} utilise ${move.icon} ${move.name} et récupère ${gain} PV !`, true);
    }
  } else if (hit) {
    if (isMe) {
      gs.theirHP -= move.dmg;
      gs.myAnim = { t: 0 };
      setTimeout(() => spawnHitParticles('their'), 300);
      setLog(`${myName} utilise ${move.icon} ${move.name} et inflige ${move.dmg} dégâts !`, false);
    } else {
      gs.myHP -= move.dmg;
      gs.theirAnim = { t: 0 };
      setTimeout(() => spawnHitParticles('mine'), 300);
      setLog(`${theirName} utilise ${move.icon} ${move.name} et inflige ${move.dmg} dégâts !`, true);
    }
  } else {
    const name = isMe ? myName : theirName;
    setLog(`${name} utilise ${move.icon} ${move.name}… mais rate !`, !isMe);
  }

  updateHPSprites();
  await delay(400);
  checkOver();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── UI helpers ── */
function setLog(text, isEnemy) {
  addLog(text, isEnemy ? 'them' : 'me');
}

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

function checkOver() {
  if (gs.theirHP <= 0 && gs.myHP <= 0) {
    showOverlay('🤝 Match nul !'); gs.over = true; return true;
  }
  if (gs.theirHP <= 0) {
    showOverlay('🏆 Victoire !\nTu as gagné !'); gs.over = true; return true;
  }
  if (gs.myHP <= 0) {
    showOverlay('💀 Défaite…\nTon adversaire a gagné.'); gs.over = true; return true;
  }
  return false;
}

function showOverlay(text) {
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('overlay-text').textContent = text;
}

/* ── Rematch ── */
function askRematch() {
  if (rematchAsked) return;
  rematchAsked = true;
  const btn = document.querySelector('#overlay .btn');
  btn.textContent = '⏳ En attente de l\'adversaire…';
  btn.disabled = true;
  btn.onclick = null;
  send({ type: 'rematch_ask' });
}

function startRematch() {
  rematchAsked = false;
  document.getElementById('overlay').style.display = 'none';
  const btn = document.querySelector('#overlay .btn');
  btn.textContent = '↺ Rejouer';
  btn.disabled = false;
  btn.onclick = askRematch;

  // Séparateur dans le log
  const box = document.getElementById('combat-log-messages');
  if (box && box.children.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'log-entry system';
    sep.innerHTML = '<span class="log-badge">•</span><span class="log-text" style="color:var(--muted)">── Nouvelle partie ──</span>';
    box.appendChild(sep);
  }

  showCharSelect();
}
