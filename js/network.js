/* ═══════════════ NETWORK ═══════════════ */
let pc = null;
let dc = null;
let isHost = false;
let roomId = '';
let pollInterval = null;
let challengePollInterval = null;
let pendingChallenge = null;

/* ── Signaling HTTP ── */
async function postSDP(key, sdp) {
  await fetch(`${SIGNAL}/${key}`, { method: 'POST', body: sdp });
}

async function getSDP(key) {
  const r = await fetch(`${SIGNAL}/${key}`);
  const txt = await r.text();
  return txt || null;
}

/* ── WebRTC ── */
function newPC() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected')                               onConnected();
    if (['disconnected','failed','closed'].includes(pc.connectionState)) onDisconnected();
  };
}

function waitICE(p) {
  return new Promise(res => {
    if (p.iceGatheringState === 'complete') { res(); return; }
    const fn = () => {
      if (p.iceGatheringState === 'complete') {
        p.removeEventListener('icegatheringstatechange', fn);
        res();
      }
    };
    p.addEventListener('icegatheringstatechange', fn);
    setTimeout(res, 4000);
  });
}

function send(obj) {
  if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj));
}

function setupDC(ch) {
  ch.onopen    = () => onConnected();
  ch.onmessage = e  => onMessage(JSON.parse(e.data));
  ch.onerror   = e  => console.error('DC error', e);
}

/* ── Rooms ── */
function randRoom() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

async function createRoom() {
  roomId = randRoom();
  isHost = true;
  await startHost(roomId);
}

async function joinRoom() {
  const code = document.getElementById('room-input').value.trim().toUpperCase();
  if (code.length !== 4) { alert('Entre un code de 4 lettres !'); return; }
  roomId = code;
  isHost = false;
  await startGuest(roomId);
}

async function joinRoomAuto(code) {
  roomId = code;
  isHost = false;
  await startGuest(roomId);
}

async function createAnon() {
  roomId = randRoom();
  isHost = true;
  showScreen('lobby');
  document.getElementById('profile-bar').style.display    = 'none';
  document.getElementById('players-panel').style.display  = 'none';
  document.getElementById('manual-panel').style.display   = 'none';
  await startHost(roomId);
}

async function joinAnon() {
  const code = document.getElementById('room-input-anon').value.trim().toUpperCase();
  if (code.length !== 4) { alert('Entre un code de 4 lettres !'); return; }
  roomId = code;
  isHost = false;
  showScreen('lobby');
  document.getElementById('profile-bar').style.display    = 'none';
  document.getElementById('players-panel').style.display  = 'none';
  document.getElementById('manual-panel').style.display   = 'none';
  await startGuest(roomId);
}

function cancelWait() {
  document.getElementById('waiting-room').style.display = 'none';
  if (pc) { pc.close(); pc = null; }
}

async function startHost(room) {
  newPC();
  dc = pc.createDataChannel('battle');
  setupDC(dc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitICE(pc);
  await postSDP(room + '-OFFER', btoa(JSON.stringify(pc.localDescription)));

  document.getElementById('room-code-display').textContent = room;
  document.getElementById('wait-status').textContent = 'En attente de l\'adversaire…';
  document.getElementById('waiting-room').style.display = 'flex';

  let tries = 0;
  const hostPoll = setInterval(async () => {
    tries++;
    const raw = await getSDP(room + '-ANSWER');
    if (raw) {
      clearInterval(hostPoll);
      document.getElementById('wait-status').textContent = 'Connexion en cours…';
      await pc.setRemoteDescription(JSON.parse(atob(raw)));
    }
    if (tries > 60) clearInterval(hostPoll);
  }, 2000);
}

async function startGuest(room) {
  document.getElementById('waiting-room').style.display = 'flex';
  document.getElementById('room-code-display').textContent = room;

  let raw = null, tries = 0;
  while (!raw && tries < 15) {
    document.getElementById('wait-status').textContent = `Recherche de la room ${room}… (${tries+1}/15)`;
    raw = await getSDP(room + '-OFFER');
    if (!raw) { await new Promise(r => setTimeout(r, 2000)); tries++; }
  }
  if (!raw) {
    alert('Room introuvable ! Vérifie le code.');
    document.getElementById('waiting-room').style.display = 'none';
    return;
  }

  newPC();
  pc.ondatachannel = e => { dc = e.channel; setupDC(dc); };
  await pc.setRemoteDescription(JSON.parse(atob(raw)));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitICE(pc);
  await postSDP(room + '-ANSWER', btoa(JSON.stringify(pc.localDescription)));
  document.getElementById('wait-status').textContent = 'Réponse envoyée, connexion en cours…';
}

/* ── Polling joueurs en ligne ── */
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
  try {
    const list = await api('/online');
    renderPlayers(list);
  } catch {}
}

async function pollChallenge() {
  if (!myToken) return;
  try {
    const data = await api('/challenged');
    if (data.challenge) {
      if (data.challenge.accepted && data.challenge.room) {
        clearInterval(challengePollInterval);
        document.getElementById('challenge-notif').style.display = 'none';
        roomId  = data.challenge.room;
        isHost  = true;
        await startHost(roomId);
        return;
      }
      if (data.challenge.declined) return;
      if (!pendingChallenge || pendingChallenge.fromId !== data.challenge.fromId) {
        pendingChallenge = data.challenge;
        showChallengeNotif(data.challenge);
      }
    } else {
      hideChallengeNotif();
    }
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
    roomId  = data.room;
    isHost  = false;
    await startGuest(roomId);
  } catch { alert('Erreur lors de l\'acceptation.'); }
}

async function declineChallenge() {
  await api('/decline', 'POST');
  hideChallengeNotif();
  pendingChallenge = null;
}
