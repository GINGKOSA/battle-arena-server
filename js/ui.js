/* ═══════════════ UI ═══════════════ */

/* ── Screens ── */
function showScreen(name) {
  document.getElementById('login-screen').style.display  = name === 'login'  ? 'flex' : 'none';
  document.getElementById('lobby-screen').style.display  = name === 'lobby'  ? 'flex' : 'none';
  document.getElementById('game').style.display          = name === 'game'   ? 'flex' : 'none';
}

/* ── Joueurs en ligne ── */
function renderPlayers(list) {
  const container = document.getElementById('players-list');
  const empty     = document.getElementById('players-empty');
  const count     = document.getElementById('online-count');

  count.textContent = list.length + (list.length <= 1 ? ' joueur' : ' joueurs');

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  container.innerHTML = '';

  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <img class="player-avatar" src="${p.avatar}" alt="${p.username}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/>
      <div class="player-name">${p.username}</div>
      <button class="btn small primary" onclick="challengePlayer('${p.id}')" ${p.challenged ? 'disabled' : ''}>
        ${p.challenged ? '⏳ Occupé' : '⚔️ Défier'}
      </button>
    `;
    container.appendChild(row);
  });
}

/* ── Notif défi ── */
function showChallengeNotif(challenge) {
  document.getElementById('notif-avatar').src = challenge.avatar || '';
  document.getElementById('notif-name').textContent = challenge.from;
  document.getElementById('challenge-notif').style.display = 'flex';
}

function hideChallengeNotif() {
  if (!pendingChallenge) return;
  pendingChallenge = null;
  document.getElementById('challenge-notif').style.display = 'none';
}

/* ── Char select ── */
function showCharSelect() {
  myCharChoice   = null;
  theirCharChoice= null;
  document.getElementById('char-select').style.display  = 'flex';
  document.getElementById('battle-area').style.display  = 'none';
  document.getElementById('char-select-status').textContent = 'Choisis ton personnage !';

  const cards = document.getElementById('char-cards');
  cards.innerHTML = '';

  Object.values(CHARS).forEach(c => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.char = c.name;
    card.innerHTML = `
      <div class="char-card-icon">${c.icon}</div>
      <div class="char-card-name">${c.name}</div>
      <div class="char-card-stats">
        PV : ${c.maxHP}<br>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <span style="width:52px;font-size:10px">Vitesse</span>
          <div class="char-card-stat-bar" style="flex:1">
            <div class="char-card-stat-fill" style="width:${c.speed}%;background:${c.colorHex}"></div>
          </div>
        </div>
        <div style="margin-top:6px">${c.moves.filter(m=>!m.heal).map(m=>`${m.icon} ${m.name} — ${m.desc}`).join('<br>')}</div>
      </div>
    `;
    card.onclick = () => selectChar(c.name);
    cards.appendChild(card);
  });
}

function selectChar(charName) {
  myCharChoice = charName;
  document.querySelectorAll('.char-card').forEach(c => {
    c.style.borderColor = c.dataset.char === charName
      ? CHARS[charName].colorHex
      : 'var(--border)';
  });
  document.getElementById('char-select-status').textContent =
    `Tu as choisi ${CHARS[charName].icon} ${charName} — en attente de l'adversaire…`;
  send({ type: 'char_choice', char: charName });
  if (theirCharChoice) startBattle();
}

/* ── Chat ── */
function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!dc || dc.readyState !== 'open') { addChatMsg('⚠️ Pas encore connecté.', null); return; }
  send({ type: 'chat', text });
  addChatMsg(text, true);
  input.value = '';
}

function addChatMsg(text, isMe) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (isMe === null) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    div.className = 'chat-msg ' + (isMe ? 'me' : 'them');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = isMe
      ? (myProfile ? myProfile.username : (myChar ? myChar.name : 'Moi'))
      : (theirChar ? theirChar.name : 'Adversaire');
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = text;
    div.appendChild(who);
    div.appendChild(txt);
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
