/* ═══════════════ NETWORK — Hub WebRTC ═══════════════
   L'hôte (slot 0) est connecté à tous les autres.
   Les guests se connectent uniquement à l'hôte.
   L'hôte redistribue les messages à tous.
================================================================ */

let isHost   = false;
let roomId   = '';
let mySlot   = 0;      // index dans la room (0 = hôte)
let numPlayers = 0;    // nombre total de joueurs attendus

// Connexions WebRTC : hôte a N-1 pcs, guest en a 1
const pcs = {};  // { slot: RTCPeerConnection }
const dcs = {};  // { slot: RTCDataChannel }

let pollInterval          = null;
let challengePollInterval = null;
let pendingChallenge      = null;

/* ── Signaling HTTP ── */
async function postSDP(key, sdp) {
  await fetch(`${SIGNAL}/${key}`, { method: 'POST', body: sdp });
}

async function getSDP(key) {
  const r = await fetch(`${SIGNAL}/${key}`);
  const txt = await r.text();
  return txt || null;
}

/* ── Création d'une connexion WebRTC ── */
function newPC(slot) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') onPeerConnected(slot);
    if (['disconnected','failed','closed'].includes(pc.connectionState)) onPeerDisconnected(slot);
  };
  pcs[slot] = pc;
  return pc;
}

function waitICE(pc) {
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') { res(); return; }
    const fn = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', fn); res(); } };
    pc.addEventListener('icegatheringstatechange', fn);
    setTimeout(res, 4000);
  });
}

/* ── Envoyer un message ── */
// Envoie à un slot spécifique (hôte seulement)
function sendTo(slot, obj) {
  const dc = dcs[slot];
  if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj));
}

// Broadcast à tous sauf soi-même (hôte)
function broadcast(obj, exceptSlot = -1) {
  Object.entries(dcs).forEach(([slot, dc]) => {
    if (parseInt(slot) !== exceptSlot && dc.readyState === 'open') {
      dc.send(JSON.stringify(obj));
    }
  });
}

// Envoie vers l'hôte (guest) ou broadcast (hôte)
function send(obj) {
  if (isHost) {
    broadcast(obj);
  } else {
    sendTo(0, obj); // le guest envoie toujours à l'hôte (slot 0)
  }
}

// Envoie à tous y compris soi-même (pour traitement uniforme)
function sendAll(obj) {
  onMessage(obj); // traite localement
  if (isHost) broadcast(obj);
  else sendTo(0, obj);
}

/* ── Réception d'un message ── */
function onDCMessage(slot, raw) {
  const msg = JSON.parse(raw);
  msg._from = slot; // ajoute l'expéditeur

  if (isHost) {
    // L'hôte redistribue aux autres puis traite
    broadcast(msg, slot);
  }
  onMessage(msg);
}

/* ── Setup DataChannel ── */
function setupDC(dc, slot) {
  dcs[slot] = dc;
  dc.onopen = () => {
    setTimeout(() => {
      send({ type: 'pseudo', name: myPseudo || 'Joueur', slot: mySlot });
    }, 100);
    onPeerConnected(slot);
  };
  dc.onmessage = e => onDCMessage(slot, e.data);
  dc.onerror   = e => console.error(`DC[${slot}] error`, e);
}

/* ── Rooms ── */
function randRoom() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

/* ── Créer une room (hôte) ── */
async function createRoom() {
  if (!myPseudo) { const p = promptPseudo(); if (!p) return; myPseudo = p; }
  roomId  = randRoom();
  isHost  = true;
  mySlot  = 0;
  numPlayers = MODES[currentMode].maxPlayers;
  await startHost(roomId);
}

/* ── Rejoindre une room (guest) ── */
async function joinRoom() {
  if (!myPseudo) { const p = promptPseudo(); if (!p) return; myPseudo = p; }
  const code = document.getElementById('room-input').value.trim().toUpperCase();
  if (code.length !== 4) { alert('Entre un code de 4 lettres !'); return; }
  roomId = code;
  isHost = false;
  await startGuest(roomId);
}

async function joinRoomAuto(code, host) {
  roomId = code;
  isHost = host;
  mySlot = host ? 0 : -1; // sera assigné par l'hôte
  if (isHost) await startHost(roomId);
  else        await startGuest(roomId);
}

async function createAnon() {
  const p = promptPseudo(); if (!p) return; myPseudo = p;
  roomId = randRoom(); isHost = true; mySlot = 0;
  numPlayers = MODES[currentMode].maxPlayers;
  showScreen('lobby');
  ['profile-bar','players-panel','manual-panel'].forEach(id => document.getElementById(id).style.display = 'none');
  await startHost(roomId);
}

async function joinAnon() {
  const p = promptPseudo(); if (!p) return; myPseudo = p;
  const code = document.getElementById('room-input-anon').value.trim().toUpperCase();
  if (code.length !== 4) { alert('Entre un code de 4 lettres !'); return; }
  roomId = code; isHost = false;
  showScreen('lobby');
  ['profile-bar','players-panel','manual-panel'].forEach(id => document.getElementById(id).style.display = 'none');
  await startGuest(roomId);
}

function promptPseudo() {
  const p = prompt('Entre ton pseudo :');
  if (!p || !p.trim()) return null;
  return p.trim().slice(0, 20);
}

function cancelWait() {
  document.getElementById('waiting-room').style.display = 'none';
  Object.values(pcs).forEach(pc => pc.close());
}

/* ── Hôte : crée N-1 offres (une par guest slot) ── */
async function startHost(room) {
  const n = numPlayers;

  document.getElementById('room-code-display').textContent = room;
  document.getElementById('wait-status').textContent = `En attente des joueurs… (1/${n})`;
  document.getElementById('waiting-room').style.display = 'flex';

  // Crée une offre pour chaque slot guest
  for (let slot = 1; slot < n; slot++) {
    const pc = newPC(slot);
    const dc = pc.createDataChannel('battle');
    setupDC(dc, slot);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitICE(pc);
    await postSDP(`${room}-OFFER-${slot}`, btoa(JSON.stringify(pc.localDescription)));
  }

  // Polling pour recevoir les réponses
  let connected = 0;
  const hostPoll = setInterval(async () => {
    for (let slot = 1; slot < n; slot++) {
      if (dcs[slot] && dcs[slot].readyState === 'open') continue;
      const raw = await getSDP(`${room}-ANSWER-${slot}`);
      if (raw) {
        await pcs[slot].setRemoteDescription(JSON.parse(atob(raw)));
      }
    }
    connected = Object.values(dcs).filter(dc => dc.readyState === 'open').length;
    document.getElementById('wait-status').textContent = `En attente des joueurs… (${connected+1}/${n})`;
    if (connected >= n - 1) clearInterval(hostPoll);
  }, 2000);
}

/* ── Guest : récupère l'offre de l'hôte ── */
async function startGuest(room) {
  document.getElementById('waiting-room').style.display = 'flex';
  document.getElementById('room-code-display').textContent = room;

  // Cherche quel slot est dispo (essaie slot 1, 2, 3)
  let myOffer = null;
  let foundSlot = -1;
  let tries = 0;

  while (!myOffer && tries < 20) {
    document.getElementById('wait-status').textContent = `Recherche de la room ${room}… (${tries+1}/20)`;
    for (let slot = 1; slot <= 3; slot++) {
      if (mySlot === slot) continue;
      const raw = await getSDP(`${room}-OFFER-${slot}`);
      if (raw) {
        myOffer    = raw;
        foundSlot  = slot;
        mySlot     = slot;
        break;
      }
    }
    if (!myOffer) { await new Promise(r => setTimeout(r, 2000)); tries++; }
  }

  if (!myOffer) {
    alert('Room introuvable ou complète !');
    document.getElementById('waiting-room').style.display = 'none';
    return;
  }

  const pc = newPC(0); // connecté à l'hôte (slot 0)
  pc.ondatachannel = e => setupDC(e.channel, 0);
  await pc.setRemoteDescription(JSON.parse(atob(myOffer)));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitICE(pc);
  await postSDP(`${room}-ANSWER-${foundSlot}`, btoa(JSON.stringify(pc.localDescription)));
  document.getElementById('wait-status').textContent = 'Réponse envoyée, connexion en cours…';
}

/* ── Connexions ── */
let connectedCount = 0;

function onPeerConnected(slot) {
  connectedCount++;
  const needed = isHost ? (numPlayers - 1) : 1;
  if (connectedCount >= needed) {
    if (isHost) {
      // Informe tous les guests du mode, du nombre de joueurs et de leurs slots
      setTimeout(() => {
        broadcast({ type: 'room_info', mode: currentMode, teamHPMode, numPlayers, slots: buildSlotMap() });
        onAllConnected();
      }, 300);
    } else {
      onAllConnected();
    }
  }
}

function buildSlotMap() {
  // L'hôte construit la map slot → pseudo
  const map = { 0: myPseudo || 'Hôte' };
  return map;
}

function onPeerDisconnected(slot) {
  if (!gs.over) addLog(`⚠️ Joueur ${slot+1} déconnecté.`, 'system');
}

function onAllConnected() {
  if (document.getElementById('game').style.display === 'flex') return;
  stopPolls();
  document.getElementById('waiting-room').style.display = 'none';
  showScreen('game');
  showCharSelect();
}

/* ── Polling joueurs en ligne ── */
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(SIGNAL + path, opts);
  return r.json();
}

function startPolls() {
  pollOnline();
  pollInterval = setInterval(pollOnline, 5000);
  challengePollInterval = setInterval(pollChallenge, 3000);
}

function stopPolls() {
  clearInterval(pollInterval);
  clearInterval(challengePollInterval);
}

async function pollOnline() {
  if (!myToken) return;
  try { renderPlayers(await api('/online')); } catch {}
}

async function pollChallenge() {
  if (!myToken) return;
  try {
    const data = await api('/challenged');
    if (data.challenge) {
      if (data.challenge.accepted && data.challenge.room) {
        clearInterval(challengePollInterval);
        document.getElementById('challenge-notif').style.display = 'none';
        roomId = data.challenge.room;
        isHost = data.challenge.isHost === true;
        mySlot = isHost ? 0 : -1;
        numPlayers = 2; // défis Discord = 1v1 par défaut
        if (isHost) await startHost(roomId);
        else        await startGuest(roomId);
        return;
      }
      if (data.challenge.declined) return;
      if (!pendingChallenge || pendingChallenge.fromId !== data.challenge.fromId) {
        pendingChallenge = data.challenge;
        showChallengeNotif(data.challenge);
      }
    } else { hideChallengeNotif(); }
  } catch {}
}

async function challengePlayer(targetId) {
  try { await api('/challenge/' + targetId, 'POST'); }
  catch { alert('Impossible de défier ce joueur.'); }
}

async function acceptChallenge() {
  try {
    const data = await api('/accept', 'POST');
    document.getElementById('challenge-notif').style.display = 'none';
    pendingChallenge = null;
    roomId = data.room;
    isHost = data.isHost === true;
    mySlot = isHost ? 0 : -1;
    numPlayers = 2;
    if (isHost) await startHost(roomId);
    else        await startGuest(roomId);
  } catch { alert('Erreur lors de l\'acceptation.'); }
}

async function declineChallenge() {
  await api('/decline', 'POST');
  hideChallengeNotif();
  pendingChallenge = null;
}
