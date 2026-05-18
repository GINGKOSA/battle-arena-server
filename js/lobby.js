'use strict';
/* ═══════════════ LOBBY IN-GAME ═══════════════
   Affiché après connexion WebRTC.
   L'hôte choisit le mode, tous marquent "Prêt".
   Dès que tous sont prêts → char select.
================================================ */

/* ── Rendu du lobby ── */
function renderLobby() {
  document.getElementById('game-lobby').style.display = 'flex';
  document.getElementById('char-select').style.display = 'none';
  document.getElementById('battle-area').style.display = 'none';

  // Mode : visible seulement pour l'hôte
  const modeSection = document.getElementById('lobby-mode-section');
  modeSection.style.display = G.isHost ? 'flex' : 'none';

  renderModeButtons();
  renderLobbyPlayers();
  renderReadyBtn();
}

function renderModeButtons() {
  const n = G.lobbyPlayers.length;
  const modes = MODES_BY_COUNT[n] || MODES_BY_COUNT[2];
  const container = document.getElementById('lobby-modes');
  container.innerHTML = '';
  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'mode-pill' + (G.mode===m.id?' active':'');
    btn.textContent = `${m.icon} ${m.label}`;
    btn.onclick = () => {
      G.mode = m.id;
      // Options 2v2
      document.getElementById('lobby-2v2-opts').style.display = m.id==='2v2'?'flex':'none';
      renderModeButtons();
      broadcast({type:'lobby_state', mode:G.mode, teamHPMode:G.teamHPMode, players:G.lobbyPlayers});
    };
    container.appendChild(btn);
  });
  document.getElementById('lobby-2v2-opts').style.display = G.mode==='2v2'?'flex':'none';
}

function renderLobbyPlayers() {
  const list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  G.lobbyPlayers.forEach(p => {
    const row = document.createElement('div');
    row.className = 'lobby-player-row';
    row.style.borderLeftColor = SLOT_CLR[p.slot]||'var(--border)';
    row.innerHTML = `
      <div class="lp-avatar" style="background:${SLOT_CLR[p.slot]||'#333'}">${p.avatar?`<img src="${p.avatar}" onerror="this.style.display='none'"/>`:''}
        <span>${p.pseudo.charAt(0).toUpperCase()}</span>
      </div>
      <div class="lp-info">
        <span class="lp-name">${p.pseudo}</span>
        ${p.slot===0?'<span class="lp-host">Hôte</span>':''}
      </div>
      <div class="lp-ready ${p.ready?'yes':'no'}">${p.ready?'✅ Prêt':'⏳ …'}</div>
    `;
    list.appendChild(row);
  });

  // Compte
  const n = G.lobbyPlayers.length;
  document.getElementById('lobby-count').textContent = `${n} joueur${n>1?'s':''}`;
}

function renderReadyBtn() {
  const me = G.lobbyPlayers.find(p=>p.slot===G.mySlot);
  const btn = document.getElementById('ready-btn');
  if (!me) return;
  if (me.ready) {
    btn.textContent = '⏳ En attente…';
    btn.disabled = true;
  } else {
    btn.textContent = '✅ Je suis prêt !';
    btn.disabled = false;
  }
}

/* ── Prêt ── */
function setReady() {
  const me = G.lobbyPlayers.find(p=>p.slot===G.mySlot);
  if (!me || me.ready) return;
  me.ready = true;
  send({type:'player_ready', slot:G.mySlot});
  renderLobbyPlayers();
  renderReadyBtn();
  checkAllReady();
}

function checkAllReady() {
  if (G.lobbyPlayers.length < 2) return;
  if (G.lobbyPlayers.every(p=>p.ready)) startCharSelect();
}

/* ── Messages lobby ── */
function handleLobbyMessage(msg) {
  switch(msg.type) {
    case 'hello':
      addLobbyPlayer(msg.slot, msg.pseudo, msg.avatar||null);
      // Hôte renvoie l'état complet
      if (G.isHost) broadcast({type:'lobby_state', mode:G.mode, teamHPMode:G.teamHPMode, players:G.lobbyPlayers});
      break;
    case 'lobby_state':
      G.mode = msg.mode;
      G.teamHPMode = msg.teamHPMode||'individual';
      G.lobbyPlayers = msg.players;
      renderLobby();
      break;
    case 'player_ready':
      { const p=G.lobbyPlayers.find(x=>x.slot===msg.slot); if(p) p.ready=true; }
      renderLobbyPlayers();
      checkAllReady();
      break;
  }
}

function addLobbyPlayer(slot, pseudo, avatar) {
  if (G.lobbyPlayers.find(p=>p.slot===slot)) return;
  G.lobbyPlayers.push({slot, pseudo, avatar, ready:false});
  renderLobbyPlayers();
  renderModeButtons(); // mise à jour modes dispo
  if (G.isHost) broadcast({type:'lobby_state', mode:G.mode, teamHPMode:G.teamHPMode, players:G.lobbyPlayers});
}

/* ── Transition vers char select ── */
function startCharSelect() {
  G.phase = 'charselect';
  document.getElementById('game-lobby').style.display = 'none';
  document.getElementById('char-select').style.display = 'flex';
  document.getElementById('char-select-status').textContent = 'Choisis ton personnage !';
  renderCharCards();
}
