'use strict';
/* ═══════════════ UI ═══════════════ */

/* ── Screens ── */
function showScreen(name) {
  const wr = document.getElementById('waiting-room');
  if (wr) wr.style.display = 'none';

  const map = { login: 'login-screen', lobby: 'lobby-screen', game: 'game' };
  Object.entries(map).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (k === name) ? 'flex' : 'none';
  });
}

/* ── Online players ── */
function renderOnlinePlayers(list) {
  const el    = document.getElementById('players-list');
  const empty = document.getElementById('players-empty');
  document.getElementById('online-count').textContent =
    `${list.length} joueur${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    el.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  el.innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <img class="player-avatar" src="${p.avatar}" alt=""
        onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/>
      <div class="player-name">${p.username}</div>
      <button class="btn small primary" onclick="challengePlayer('${p.id}')" ${p.busy ? 'disabled' : ''}>
        ${p.busy ? '⏳' : '⚔️ Défier'}
      </button>`;
    el.appendChild(row);
  });
}

/* ── Chat ── */
function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  const anyOpen = Object.values(dcs).some(dc => dc.readyState === 'open');
  if (!anyOpen) { addChatMsg('⚠️ Non connecté.', null, null); return; }
  send({ type: 'chat', text, slot: G.mySlot });
  addChatMsg(text, true, G.mySlot);
  input.value = '';
}

function addChatMsg(text, isMe, slot) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');

  if (isMe === null) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    div.className = 'chat-msg ' + (isMe ? 'me' : 'them');
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = SLOT_CLR[slot ?? 0] || 'var(--fire)';
    who.textContent = isMe
      ? (G.myPseudo || 'Moi')
      : (G.players.find(p => p.slot === slot)?.pseudo ||
         G.lobbyPlayers.find(p => p.slot === slot)?.pseudo ||
         `J${(slot || 0) + 1}`);
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = text;
    div.appendChild(who);
    div.appendChild(txt);
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

/* ══════════════════════════════════════════════════
   COMBAT LOG — style Pokémon DS
   • Le texte s'affiche dans la boîte de dialogue
     de l'écran du haut (#pkm-dialog-text), lettre
     par lettre avec effet typewriter.
   • Il est aussi archivé dans #combat-log-messages
     (écran du bas) pour relecture.
══════════════════════════════════════════════════ */

let _dialogQueue = [];   // file d'attente des messages
let _dialogBusy  = false; // typewriter en cours ?

function addLog(text, type = 'system') {
  // 1. Archiver dans le log du bas (historique)
  const box = document.getElementById('combat-log-messages');
  if (box) {
    const e = document.createElement('div');
    e.className = 'log-entry ' + type;
    const b = document.createElement('span');
    b.className = 'log-badge';
    b.textContent = type === 'me' ? 'Toi' : type === 'them' ? 'Ennemi' : '•';
    const t = document.createElement('span');
    t.className = 'log-text';
    t.textContent = text;
    e.appendChild(b);
    e.appendChild(t);
    box.appendChild(e);
    box.scrollTop = box.scrollHeight;
  }

  // 2. Afficher dans la boîte de dialogue (écran du haut)
  _dialogQueue.push({ text, type });
  if (!_dialogBusy) _nextDialog();
}

function _nextDialog() {
  if (!_dialogQueue.length) { _dialogBusy = false; return; }
  _dialogBusy = true;
  const { text, type } = _dialogQueue.shift();

  const el = document.getElementById('pkm-dialog-text');
  if (!el) { _nextDialog(); return; }

  // Couleur selon le type
  const color = type === 'me' ? '#cc3300' : type === 'them' ? '#0055aa' : '#1a1a1a';
  el.style.color = color;
  el.textContent = '';

  // Typewriter lettre par lettre
  let i = 0;
  const speed = Math.max(18, Math.min(40, 1200 / text.length)); // adaptatif
  const iv = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) {
      clearInterval(iv);
      // Pause avant le prochain message
      setTimeout(_nextDialog, text.length > 40 ? 1800 : 1200);
    }
  }, speed);
}
