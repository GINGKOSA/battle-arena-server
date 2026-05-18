'use strict';
/* ═══════════════ NETWORK ═══════════════
   Hub model : hôte (slot 0) connecté à tous.
   Guests → connecté à l'hôte uniquement.
   L'hôte redistribue (broadcast).
================================================ */

const pcs = {};   // slot → RTCPeerConnection
const dcs = {};   // slot → RTCDataChannel

/* ── API Discord ── */
const api = async (path, method='GET', data=null) => {
  const r = await fetch(SIGNAL+path, {
    method,
    headers:{ Authorization:`Bearer ${G.myToken}`, 'Content-Type':'application/json' },
    ...(data ? {body:JSON.stringify(data)} : {})
  });
  return r.json();
};

/* ── Signaling ── */
const postSDP = async (key,sdp) => fetch(`${SIGNAL}/${key}`,{method:'POST',body:sdp});
const getSDP  = async key => { const r=await fetch(`${SIGNAL}/${key}`); const t=await r.text(); return t||null; };

/* ── WebRTC ── */
const newPC = slot => {
  const pc = new RTCPeerConnection({iceServers:ICE});
  pc.onconnectionstatechange = () => {
    if (pc.connectionState==='connected')                               onPeerUp(slot);
    if (['disconnected','failed','closed'].includes(pc.connectionState)) onPeerDown(slot);
  };
  pcs[slot] = pc;
  return pc;
};

const waitICE = pc => new Promise(ok => {
  if (pc.iceGatheringState==='complete') { ok(); return; }
  const fn = () => { if (pc.iceGatheringState==='complete'){ pc.removeEventListener('icegatheringstatechange',fn); ok(); }};
  pc.addEventListener('icegatheringstatechange', fn);
  setTimeout(ok, 4000);
});

const setupDC = (dc, slot) => {
  dcs[slot] = dc;
  dc.onopen    = () => { setTimeout(()=>send({type:'hello',slot:G.mySlot,pseudo:G.myPseudo||'Joueur'}),120); onPeerUp(slot); };
  dc.onmessage = e  => recv(slot, JSON.parse(e.data));
  dc.onerror   = e  => console.warn('DC',slot,e);
};

/* ── Envoi / réception ── */
const sendTo = (slot, msg) => { const dc=dcs[slot]; if(dc?.readyState==='open') dc.send(JSON.stringify(msg)); };

const broadcast = (msg, except=-1) =>
  Object.entries(dcs).forEach(([s,dc]) => { if(+s!==except && dc.readyState==='open') dc.send(JSON.stringify(msg)); });

// Envoyer depuis n'importe quel joueur
const send = msg => { G.isHost ? broadcast(msg) : sendTo(0, msg); };

// Hôte : reçoit un message d'un guest et redistribue avant de traiter
const recv = (fromSlot, msg) => {
  if (G.isHost && fromSlot!==0) broadcast(msg, fromSlot);
  onMessage(msg);
};

/* ── Création de room (hôte) ── */
const startHost = async () => {
  const n = G.lobbyPlayers.length; // nb max attendu (1v1=2, ffa/2v2=2-4)
  const maxSlots = 4; // on prépare 3 offres max

  for (let slot=1; slot<=3; slot++) {
    const pc = newPC(slot);
    const dc = pc.createDataChannel('ba');
    setupDC(dc, slot);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitICE(pc);
    await postSDP(`${G.roomId}-O${slot}`, btoa(JSON.stringify(pc.localDescription)));
  }

  // Polling réponses
  const poll = setInterval(async () => {
    for (let slot=1; slot<=3; slot++) {
      if (dcs[slot]?.readyState==='open') continue;
      const raw = await getSDP(`${G.roomId}-A${slot}`);
      if (raw) await pcs[slot].setRemoteDescription(JSON.parse(atob(raw)));
    }
    updateWaitUI();
  }, 2000);

  G._hostPoll = poll;
};

/* ── Rejoindre une room (guest) ── */
const startGuest = async () => {
  // Cherche le premier slot libre (O1, O2, O3)
  let raw=null, slot=-1, tries=0;
  setWaitStatus(`Recherche de la room ${G.roomId}…`);
  while (!raw && tries<15) {
    for (let s=1; s<=3; s++) {
      raw = await getSDP(`${G.roomId}-O${s}`);
      if (raw) { slot=s; G.mySlot=s; break; }
    }
    if (!raw) { await delay(2000); tries++; setWaitStatus(`Recherche… (${tries}/15)`); }
  }
  if (!raw) { alert('Room introuvable !'); showScreen('lobby'); return; }

  const pc = newPC(0);
  pc.ondatachannel = e => setupDC(e.channel, 0);
  await pc.setRemoteDescription(JSON.parse(atob(raw)));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  await waitICE(pc);
  await postSDP(`${G.roomId}-A${slot}`, btoa(JSON.stringify(pc.localDescription)));
  setWaitStatus('Connexion en cours…');
};

/* ── Callbacks connexion ── */
let _connectedSlots = new Set();

function onPeerUp(slot) {
  _connectedSlots.add(slot);
  updateWaitUI();
};

const onPeerDown = slot => {
  _connectedSlots.delete(slot);
  if (G.phase!=='over') addLog(`⚠️ Joueur ${slot+1} déconnecté.`,'system');
};

const updateWaitUI = () => {
  const n = _connectedSlots.size + 1; // +1 pour soi
  setWaitStatus(`${n} joueur${n>1?'s':''} connecté${n>1?'s':''}…`);
};

/* ── Rooms haut niveau ── */
const randRoom = () => Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random()*23)]).join('');

async function createRoom() {
  const p = ensurePseudo(); if (!p) return;
  G.myPseudo = p; G.isHost = true; G.mySlot = 0; G.roomId = randRoom();
  G.lobbyPlayers = [{slot:0,pseudo:p,avatar:G.myProfile?.avatar||null,ready:false}];
  showRoomWait();
  await startHost();
}

async function joinRoom() {
  const p = ensurePseudo(); if (!p) return;
  const code = document.getElementById('room-input').value.trim().toUpperCase();
  if (code.length!==4) { alert('Code de 4 lettres requis !'); return; }
  G.myPseudo = p; G.isHost = false; G.roomId = code;
  showRoomWait();
  await startGuest();
}

async function createAnon() {
  const p = ensurePseudo(); if (!p) return;
  G.myPseudo = p; G.isHost = true; G.mySlot = 0; G.roomId = randRoom();
  G.lobbyPlayers = [{slot:0,pseudo:p,avatar:null,ready:false}];
  showRoomWait();
  await startHost();
}

async function joinAnon() {
  const p = ensurePseudo(); if (!p) return;
  const code = document.getElementById('room-input-anon').value.trim().toUpperCase();
  if (code.length!==4) { alert('Code de 4 lettres requis !'); return; }
  G.myPseudo = p; G.isHost = false; G.roomId = code;
  showRoomWait();
  await startGuest();
}

const ensurePseudo = () => {
  if (G.myPseudo) return G.myPseudo;
  const p = prompt('Ton pseudo :')?.trim().slice(0,20);
  return p || null;
};

function showRoomWait() {
  document.getElementById('room-code-display').textContent = G.roomId;
  setWaitStatus('Connexion…');
  document.getElementById('waiting-room').style.display = 'flex';
}

function cancelWait() {
  clearInterval(G._hostPoll);
  Object.values(pcs).forEach(pc=>pc.close());
  document.getElementById('waiting-room').style.display = 'none';
}

const setWaitStatus = t => { const el=document.getElementById('wait-status'); if(el) el.textContent=t; };

/* ── Challenge via Discord ── */
let _pendingChallenge = null;
let _pollI=null, _chalI=null;

function startPolls() {
  pollOnline();
  _pollI = setInterval(pollOnline, 5000);
  _chalI = setInterval(pollChallenge, 3000);
}

function stopPolls() { clearInterval(_pollI); clearInterval(_chalI); }

async function pollOnline() {
  if (!G.myToken) return;
  try { renderOnlinePlayers(await api('/online')); } catch {}
}

async function pollChallenge() {
  if (!G.myToken) return;
  try {
    const {challenge: c} = await api('/challenged');
    if (!c) { hideNotif(); return; }
    if (c.accepted && c.room) {
      clearInterval(_chalI);
      hideNotif();
      G.roomId=c.room; G.isHost=c.isHost; G.mySlot=G.isHost?0:-1;
      showRoomWait();
      G.isHost ? await startHost() : await startGuest();
      return;
    }
    if (c.declined) return;
    if (_pendingChallenge?.fromId!==c.fromId) { _pendingChallenge=c; showNotif(c); }
  } catch {}
}

async function challengePlayer(id) {
  try { await api(`/challenge/${id}`,'POST'); } catch { alert('Impossible.'); }
}

async function acceptChallenge() {
  try {
    const d = await api('/accept','POST');
    hideNotif(); _pendingChallenge=null;
    G.roomId=d.room; G.isHost=d.isHost; G.mySlot=G.isHost?0:-1;
    showRoomWait();
    G.isHost ? await startHost() : await startGuest();
  } catch { alert('Erreur.'); }
}

async function declineChallenge() {
  await api('/decline','POST'); hideNotif(); _pendingChallenge=null;
}

const showNotif = c => {
  document.getElementById('notif-avatar').src = c.avatar||'';
  document.getElementById('notif-name').textContent = c.from;
  document.getElementById('challenge-notif').style.display = 'flex';
};
const hideNotif = () => {
  if (!_pendingChallenge) return;
  _pendingChallenge=null;
  document.getElementById('challenge-notif').style.display='none';
};
