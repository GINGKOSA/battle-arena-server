'use strict';
/* ═══════════════ NETWORK ═══════════════
   Hub model : hôte (slot 0) connecté à tous les guests.
   Guests → connectés à l'hôte uniquement.
   L'hôte redistribue (broadcast) tous les messages.

   CORRECTION BUG LOBBY :
   - onPeerUp déclenche la transition waiting-room → game-lobby pour l'hôte
   - L'hôte reçoit "hello" et répond avec lobby_state complet
   - Le guest reçoit lobby_state et passe lui aussi en game-lobby
   - Un seul fichier réseau (network.js), plus de conflit net.js/network.js
================================================ */

const pcs = {};   // slot → RTCPeerConnection
const dcs = {};   // slot → RTCDataChannel

/* ── Discord API ── */
const api = async (path, method = 'GET', data = null) => {
  const r = await fetch(SIGNAL + path, {
    method,
    headers: { Authorization: `Bearer ${G.myToken}`, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  return r.json();
};

/* ── Signaling HTTP ── */
const postSDP = (key, sdp) => fetch(`${SIGNAL}/${key}`, { method: 'POST', body: sdp });
const getSDP  = async key => {
  const r = await fetch(`${SIGNAL}/${key}`);
  const t = await r.text();
  return t || null;
};

/* ── WebRTC ── */
const newPC = slot => {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected')                                onPeerUp(slot);
    if (['disconnected','failed','closed'].includes(pc.connectionState))   onPeerDown(slot);
  };
  pcs[slot] = pc;
  return pc;
};

const waitICE = pc => new Promise(ok => {
  if (pc.iceGatheringState === 'complete') { ok(); return; }
  const fn = () => {
    if (pc.iceGatheringState === 'complete') {
      pc.removeEventListener('icegatheringstatechange', fn);
      ok();
    }
  };
  pc.addEventListener('icegatheringstatechange', fn);
  setTimeout(ok, 4000);
});

const setupDC = (dc, slot) => {
  dcs[slot] = dc;
  dc.onopen    = () => {
    // Envoyer notre identité dès l'ouverture du canal
    setTimeout(() => {
      const hello = { type: 'hello', slot: G.mySlot, pseudo: G.myPseudo || 'Joueur', avatar: G.myProfile?.avatar || null };
      // Le guest envoie à l'hôte ; l'hôte envoie à tous
      sendTo(slot, hello);
    }, 150);
    onPeerUp(slot);
  };
  dc.onmessage = e  => recv(slot, JSON.parse(e.data));
  dc.onerror   = e  => console.warn('DC error slot', slot, e);
};

/* ── Envoi / réception ── */
const sendTo = (slot, msg) => {
  const dc = dcs[slot];
  if (dc && dc.readyState === 'open') dc.send(JSON.stringify(msg));
};

const broadcast = (msg, except = -1) => {
  Object.entries(dcs).forEach(([s, dc]) => {
    if (+s !== except && dc.readyState === 'open') dc.send(JSON.stringify(msg));
  });
};

// send : hôte → broadcast à tous ; guest → envoie à l'hôte (slot 0)
const send = msg => {
  if (G.isHost) broadcast(msg);
  else sendTo(0, msg);
};

// Réception : l'hôte redistribue puis traite
const recv = (fromSlot, msg) => {
  if (G.isHost && fromSlot !== 0) broadcast(msg, fromSlot);
  onMessage(msg);
};

/* ── Hôte : crée 3 offres (slots 1-3) ── */
const startHost = async () => {
  for (let slot = 1; slot <= 3; slot++) {
    const pc = newPC(slot);
    const dc = pc.createDataChannel('ba');
    setupDC(dc, slot);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitICE(pc);
    await postSDP(`${G.roomId}-O${slot}`, btoa(JSON.stringify(pc.localDescription)));
  }

  // Polling answers
  G._hostPoll = setInterval(async () => {
    for (let slot = 1; slot <= 3; slot++) {
      if (dcs[slot]?.readyState === 'open') continue;
      const raw = await getSDP(`${G.roomId}-A${slot}`);
      if (raw) {
        try { await pcs[slot].setRemoteDescription(JSON.parse(atob(raw))); } catch {}
      }
    }
    updateWaitStatus();
  }, 2000);
};

/* ── Guest : récupère une offre ── */
const startGuest = async () => {
  setWaitStatus(`Recherche de la room ${G.roomId}…`);
  let raw = null, foundSlot = -1, tries = 0;

  while (!raw && tries < 15) {
    for (let s = 1; s <= 3; s++) {
      raw = await getSDP(`${G.roomId}-O${s}`);
      if (raw) { foundSlot = s; G.mySlot = s; break; }
    }
    if (!raw) { await delay(2000); tries++; setWaitStatus(`Recherche… (${tries}/15)`); }
  }

  if (!raw) { alert('Room introuvable !'); showScreen('login'); return; }

  const pc = newPC(0);
  pc.ondatachannel = e => setupDC(e.channel, 0);
  await pc.setRemoteDescription(JSON.parse(atob(raw)));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  await waitICE(pc);
  await postSDP(`${G.roomId}-A${foundSlot}`, btoa(JSON.stringify(pc.localDescription)));
  setWaitStatus('Connexion en cours…');
};

/* ── Callbacks connexion ──
   BUG FIX : c'est ici qu'on déclenche la transition vers le game-lobby
   Pour l'hôte : dès qu'un peer se connecte → sortir du waiting-room → game-lobby
   Pour le guest : la transition arrive via message lobby_state reçu de l'hôte
*/
function onPeerUp(slot) {
  updateWaitStatus();

  if (G.isHost) {
    clearInterval(G._hostPoll);
    G._hostPoll = null;

    // Si on vient du waiting-room (mode code), passer au game-lobby
    // Si on est déjà dans le game-lobby (mode lobby public), juste mettre à jour
    if (G.phase === 'waiting') {
      stopPolls();
      document.getElementById('waiting-room').style.display = 'none';
      const anonWrap = document.getElementById('anon-wait-wrap');
      if (anonWrap) anonWrap.style.display = 'none';
      showScreen('game');
      G.phase = 'lobby';
    }

    // S'ajouter si pas encore fait
    if (!G.lobbyPlayers.find(p => p.slot === 0)) {
      G.lobbyPlayers = [{ slot: 0, pseudo: G.myPseudo, avatar: G.myProfile?.avatar || null, ready: false }];
    }
    renderLobby();

    // Relancer le polling pour d'éventuels joueurs supplémentaires
    G._hostPoll = setInterval(async () => {
      for (let s = 1; s <= 3; s++) {
        if (dcs[s]?.readyState === 'open') continue;
        const raw = await getSDP(`${G.roomId}-A${s}`);
        if (raw) {
          try { await pcs[s].setRemoteDescription(JSON.parse(atob(raw))); } catch {}
        }
      }
    }, 2000);
  }
  // Guest : il attendra le message lobby_state de l'hôte
}

function onPeerDown(slot) {
  if (G.phase !== 'over' && G.phase !== 'idle') {
    addLog(`⚠️ Joueur ${slot + 1} déconnecté.`, 'system');
  }
}

function updateWaitStatus() {
  const connected = Object.values(dcs).filter(dc => dc.readyState === 'open').length;
  const total = connected + 1;
  setWaitStatus(`${total} joueur${total > 1 ? 's' : ''} connecté${total > 1 ? 's' : ''}…`);
}

/* ── Fermer le lobby public quand la partie commence ── */
async function closeLobby() {
  if (!G.myToken || !G.isHost) return;
  try { await api('/lobby/close', 'POST'); } catch {}
}

/* ── Rooms haut niveau ── */
const randRoom4 = () =>
  Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');

const ensurePseudo = () => {
  if (G.myPseudo) return G.myPseudo;
  const p = prompt('Ton pseudo :')?.trim().slice(0, 20);
  return p || null;
};

async function createRoom() {
  const p = ensurePseudo(); if (!p) return;
  G.myPseudo = p; G.isHost = true; G.mySlot = 0; G.roomId = randRoom4();
  G.lobbyPlayers = [{ slot: 0, pseudo: p, avatar: G.myProfile?.avatar || null, ready: false }];
  G.phase = 'waiting';
  showScreen('lobby');
  showRoomWait();
  await startHost();
}

async function joinRoom() {
  const p = ensurePseudo(); if (!p) return;
  const code = document.getElementById('room-input').value.trim().toUpperCase();
  if (code.length !== 4) { alert('Code de 4 lettres requis !'); return; }
  G.myPseudo = p; G.isHost = false; G.roomId = code;
  G.phase = 'waiting';
  showScreen('lobby');
  showRoomWait();
  await startGuest();
}

async function createAnon() {
  const p = ensurePseudo(); if (!p) return;
  G.myPseudo = p; G.isHost = true; G.mySlot = 0; G.roomId = randRoom4();
  G.lobbyPlayers = [{ slot: 0, pseudo: p, avatar: null, ready: false }];
  G.phase = 'waiting';
  // Mode anonyme : on affiche un écran minimal sans le lobby Discord
  showAnonWait();
  await startHost();
}

async function joinAnon() {
  const p = ensurePseudo(); if (!p) return;
  const code = document.getElementById('room-input-anon').value.trim().toUpperCase();
  if (code.length !== 4) { alert('Code de 4 lettres requis !'); return; }
  G.myPseudo = p; G.isHost = false; G.roomId = code;
  G.phase = 'waiting';
  // Mode anonyme : on affiche un écran minimal sans le lobby Discord
  showAnonWait();
  await startGuest();
}

function showAnonWait() {
  // En mode anonyme : cacher tout sauf le waiting-room
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game').style.display         = 'none';
  showRoomWait();
}

function showRoomWait() {
  document.getElementById('room-code-display').textContent = G.roomId;
  setWaitStatus('Connexion…');
  document.getElementById('waiting-room').style.display = 'flex';
}

function cancelWait() {
  clearInterval(G._hostPoll);
  Object.values(pcs).forEach(pc => { try { pc.close(); } catch {} });
  document.getElementById('waiting-room').style.display = 'none';
  const anonWrap = document.getElementById('anon-wait-wrap');
  if (anonWrap) anonWrap.style.display = 'none';
  G.phase = 'idle';
  // Retourner à l'écran de login
  showScreen('login');
}

const setWaitStatus = t => {
  const el = document.getElementById('wait-status');
  if (el) el.textContent = t;
};

/* ── Lobbies publics ── */

async function createPublicLobby() {
  try {
    // Créer le lobby sur le serveur (sans maxSlots prédéfini — géré dans le lobby)
    const data = await api('/lobby/create', 'POST', { maxSlots: 4, mode: '1v1' });
    if (!data.room) { alert('Erreur création lobby'); return; }
    G.roomId       = data.room;
    G.isHost       = true;
    G.mySlot       = 0;
    G.mode         = '1v1';
    G.lobbyPlayers = [{ slot:0, pseudo:G.myPseudo, avatar:G.myProfile?.avatar||null, ready:false }];
    G.phase        = 'lobby';
    stopPolls();
    showScreen('game');
    renderLobby();
    // Démarrer WebRTC en arrière-plan
    await startHost();
    // Reprendre les polls Discord pour voir les joueurs qui rejoignent
    startPolls();
  } catch(e) { console.error('createPublicLobby', e); }
}

async function joinLobby(room) {
  try {
    const data = await api(`/lobby/join/${room}`, 'POST');
    if (data.accepted && data.room) {
      // Rejoindre directement
      G.roomId = data.room;
      G.isHost = false;
      G.mySlot = -1;
      G.phase  = 'waiting';
      showRoomWait();
      await startGuest();
    } else if (data.waiting) {
      // Attendre que l'hôte accepte (poll /challenged)
      G.roomId = data.room;
      G.isHost = false;
      G.phase  = 'waiting';
      showRoomWait();
      setWaitStatus('En attente de l\'hôte…');
      // Le poll challange existant va détecter l'acceptation
    }
  } catch(e) { console.error('joinLobby', e); alert('Impossible de rejoindre ce lobby.'); }
}

async function pollLobbies() {
  if (!G.myToken) return;
  try {
    const list = await api('/lobby/list');
    renderLobbyList(list);
  } catch {}
}

/* ── Discord polls ── */
let _pollI = null, _chalI = null, _pendingChallenge = null;

let _lobbyI = null;

function startPolls() {
  pollOnline();
  pollLobbies();
  _pollI  = setInterval(pollOnline,    5000);
  _chalI  = setInterval(pollChallenge, 3000);
  _lobbyI = setInterval(pollLobbies,   4000);
}

function stopPolls() {
  clearInterval(_pollI);
  clearInterval(_chalI);
  clearInterval(_lobbyI);
  _pollI = null; _chalI = null; _lobbyI = null;
}

async function pollOnline() {
  if (!G.myToken) return;
  try { renderOnlinePlayers(await api('/online')); } catch {}
}

async function pollChallenge() {
  if (!G.myToken) return;
  try {
    const { challenge: c } = await api('/challenged');
    if (!c) { hideNotif(); return; }
    if (c.accepted && c.room) {
      clearInterval(_chalI); _chalI = null;
      hideNotif();
      G.roomId = c.room; G.isHost = c.isHost; G.mySlot = G.isHost ? 0 : -1;
      G.phase = 'waiting';
      if (G.isHost) {
        G.lobbyPlayers = [{ slot: 0, pseudo: G.myPseudo, avatar: G.myProfile?.avatar || null, ready: false }];
      }
      showRoomWait();
      G.isHost ? await startHost() : await startGuest();
      return;
    }
    if (c.declined) { hideNotif(); return; }
    if (_pendingChallenge?.fromId !== c.fromId) { _pendingChallenge = c; showNotif(c); }
  } catch {}
}

async function challengePlayer(id) {
  try { await api(`/challenge/${id}`, 'POST'); }
  catch { alert('Impossible de défier ce joueur.'); }
}

async function acceptChallenge() {
  try {
    const d = await api('/accept', 'POST');
    hideNotif(); _pendingChallenge = null;
    G.roomId = d.room; G.isHost = d.isHost; G.mySlot = G.isHost ? 0 : -1;
    G.phase = 'waiting';
    if (G.isHost) {
      G.lobbyPlayers = [{ slot: 0, pseudo: G.myPseudo, avatar: G.myProfile?.avatar || null, ready: false }];
    }
    showRoomWait();
    G.isHost ? await startHost() : await startGuest();
  } catch { alert('Erreur lors de l\'acceptation.'); }
}

async function declineChallenge() {
  try { await api('/decline', 'POST'); } catch {}
  hideNotif(); _pendingChallenge = null;
}

const showNotif = c => {
  document.getElementById('notif-avatar').src = c.avatar || '';
  document.getElementById('notif-name').textContent = c.from;
  document.getElementById('challenge-notif').style.display = 'flex';
};

const hideNotif = () => {
  _pendingChallenge = null;
  const el = document.getElementById('challenge-notif');
  if (el) el.style.display = 'none';
};
