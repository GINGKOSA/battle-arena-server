'use strict';
/* ═══════════════ UI ═══════════════ */

/* ── Screens ── */
function showScreen(name) {
  // name : 'login' | 'lobby' | 'game'
  // waiting-room est au niveau racine et géré séparément — on le cache ici
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

/* ── Chat burger (mobile) ── */
function toggleChat() {
  const panel = document.getElementById('chat-panel');
  const close = document.getElementById('chat-close');
  const open  = panel.classList.toggle('open');
  if (close) close.style.display = open ? 'block' : 'none';
  if (open) setTimeout(() => {
    const m = document.getElementById('chat-messages');
    if (m) m.scrollTop = m.scrollHeight;
  }, 50);
}

document.addEventListener('click', e => {
  if (window.innerWidth > 600) return;
  const panel  = document.getElementById('chat-panel');
  const burger = document.getElementById('chat-burger');
  if (!panel || !burger) return;
  if (panel.classList.contains('open') &&
      !panel.contains(e.target) && !burger.contains(e.target)) {
    panel.classList.remove('open');
    const c = document.getElementById('chat-close');
    if (c) c.style.display = 'none';
  }
});

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

/* ── Combat log ── */
function addLog(text, type = 'system') {
  const box = document.getElementById('combat-log-messages');
  if (!box) return;
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
