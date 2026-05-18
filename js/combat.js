'use strict';
/* ═══════════════ COMBAT ═══════════════ */

/* ── Message router ── */
function onMessage(msg) {
  if (G.phase==='lobby' || G.phase==='charselect') { handleLobbyMessage(msg); return; }

  switch(msg.type) {
    case 'char_choice':  onCharChoice(msg);      break;
    case 'action':       onAction(msg);           break;
    case 'round_result': onRoundResult(msg);      break;
    case 'chat':         addChatMsg(msg.text,false,msg.slot); break;
    case 'rematch_ask':  onRematchAsk();          break;
    case 'rematch_go':   doRematch();             break;
    case 'hello':        handleLobbyMessage(msg); break;
    case 'lobby_state':  handleLobbyMessage(msg); break;
    case 'player_ready': handleLobbyMessage(msg); break;
  }
}

/* ── Peer events ── */
function onPeerUp(slot) {
  updateWaitUI();
  const el = document.getElementById('lobby-room-code');
  if (el) el.textContent = G.roomId;
  const connected = Object.values(dcs).filter(dc=>dc.readyState==='open').length;
  if (G.isHost && connected===1 && G.phase==='lobby') {
    renderLobby();
  } else if (!G.isHost && connected===1 && G.phase==='lobby') {
    document.getElementById('waiting-room').style.display='none';
    showScreen('game');
    G.phase='lobby';
    renderLobby();
  }
}

/* ── Char select ── */
const charChoices = {};  // slot → charName

function renderCharCards() {
  const cards = document.getElementById('char-cards');
  cards.innerHTML = '';
  Object.values(CHARS).forEach(c => {
    const d = document.createElement('div');
    d.className='char-card'; d.dataset.char=c.name;
    d.innerHTML=`
      <div class="char-card-icon">${c.icon}</div>
      <div class="char-card-name">${c.name}</div>
      <div class="char-card-stats">
        PV : ${c.maxHP}
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
          <span style="width:50px;font-size:10px">Vitesse</span>
          <div class="char-card-stat-bar" style="flex:1">
            <div class="char-card-stat-fill" style="width:${c.speed}%;background:${c.colorHex}"></div>
          </div>
        </div>
        ${c.moves.filter(m=>!m.heal).map(m=>`${m.icon} ${m.name} ${m.desc}`).join('<br>')}
      </div>`;
    d.onclick = () => pickChar(c.name);
    cards.appendChild(d);
  });
}

function pickChar(name) {
  charChoices[G.mySlot] = name;
  document.querySelectorAll('.char-card').forEach(c => {
    c.style.borderColor = c.dataset.char===name ? CHARS[name].colorHex : 'var(--border)';
  });
  const n = Object.keys(charChoices).length;
  const total = G.lobbyPlayers.length;
  document.getElementById('char-select-status').textContent = `${n}/${total} prêts…`;

  const msg = {type:'char_choice', slot:G.mySlot, charName:name};
  send(msg);
  if (G.isHost) onCharChoice(msg);
  if (Object.keys(charChoices).length >= total) beginFight();
}

function onCharChoice(msg) {
  charChoices[msg.slot] = msg.charName;
  const n=Object.keys(charChoices).length, total=G.lobbyPlayers.length;
  document.getElementById('char-select-status').textContent=`${n}/${total} prêts…`;
  if (n>=total) beginFight();
}

/* ── Combat ── */
function beginFight() {
  G.phase='fight';
  document.getElementById('char-select').style.display='none';
  document.getElementById('battle-area').style.display='flex';

  // Build players
  G.players = G.lobbyPlayers.map(lp => {
    const char = CHARS[charChoices[lp.slot]]||CHARS.Pyros;
    const team = G.mode==='2v2' ? (lp.slot<2?0:1) : null;
    let maxHP = char.maxHP;
    if (G.mode==='2v2' && G.teamHPMode==='shared') {
      // PV partagés : somme / 2 pour l'équipe
      maxHP = Math.round(G.lobbyPlayers.filter((_,i)=>i<2===lp.slot<2).reduce((s,_)=>s+char.maxHP,0)/2);
    }
    return {slot:lp.slot, pseudo:lp.pseudo, avatar:lp.avatar, char, hp:maxHP, maxHP, alive:true, team};
  });

  G.choices = {};
  if (!r3) initThree(); else resetThreeChars();
  renderActionPanel();
  addLog('⚔️ Que le combat commence !','system');
}

/* ── Actions ── */
function renderActionPanel() {
  const me = G.players.find(p=>p.slot===G.mySlot);
  if (!me) return;
  const grid = document.getElementById('actions-grid');
  grid.innerHTML = '';
  me.char.moves.forEach(m => {
    const btn=document.createElement('button');
    btn.className='action-btn';
    btn.innerHTML=`${m.icon} ${m.name} <span class="dmg">${m.desc}</span>`;
    btn.onclick = () => pickAction(m);
    grid.appendChild(btn);
  });
  document.getElementById('waiting-action').style.display='none';
  document.getElementById('target-picker').style.display='none';
  document.querySelectorAll('.action-btn').forEach(b=>b.disabled=false);
}

function pickAction(move) {
  if (G.choices[G.mySlot] || G.phase!=='fight') return;

  // 1v1 : cible automatique
  if (G.mode==='1v1') {
    const target = G.players.find(p=>p.slot!==G.mySlot&&p.alive);
    if (target) submitAction(move, target.slot);
    return;
  }

  // Autres modes : picker de cible
  const picker = document.getElementById('target-picker');
  picker.innerHTML = '<div class="picker-label">Choisir une cible</div>';

  const me = G.players.find(p=>p.slot===G.mySlot);
  const candidates = G.players.filter(p => {
    if (!p.alive || p.slot===G.mySlot) return false;
    if (move.heal) return G.mode==='2v2' ? p.team===me.team : p.slot===G.mySlot;
    return G.mode==='2v2' ? p.team!==me.team : true;
  });

  // Soin sur soi-même si 1v1 ou FFA
  if (move.heal && G.mode!=='2v2') {
    const btn=document.createElement('button');
    btn.className='action-btn'; btn.style.borderColor=SLOT_CLR[G.mySlot];
    btn.innerHTML=`${me.pseudo} <span class="dmg">${me.hp}/${me.maxHP}</span>`;
    btn.onclick=()=>{ picker.style.display='none'; submitAction(move,G.mySlot); };
    picker.appendChild(btn);
  }

  candidates.forEach(p => {
    const btn=document.createElement('button');
    btn.className='action-btn'; btn.style.borderColor=SLOT_CLR[p.slot];
    btn.innerHTML=`${p.pseudo} <span class="dmg">${p.hp}/${p.maxHP}</span>`;
    btn.onclick=()=>{ picker.style.display='none'; submitAction(move,p.slot); };
    picker.appendChild(btn);
  });

  picker.style.display='flex';
}

function submitAction(move, targetSlot) {
  if (G.choices[G.mySlot]) return;
  G.choices[G.mySlot] = {move, targetSlot};
  document.querySelectorAll('.action-btn').forEach(b=>b.disabled=true);
  document.getElementById('waiting-action').style.display='block';
  addLog(`${G.myPseudo} choisit ${move.icon} ${move.name}…`,'me');
  send({type:'action', slot:G.mySlot, move, targetSlot});
  if (G.isHost) tryResolve();
}

function onAction(msg) {
  G.choices[msg.slot] = {move:msg.move, targetSlot:msg.targetSlot};
  if (G.isHost) tryResolve();
}

function tryResolve() {
  if (!G.isHost) return;
  const alive = G.players.filter(p=>p.alive).map(p=>p.slot);
  if (alive.every(s=>G.choices[s])) resolveRound();
}

/* ── Résolution (hôte autoritaire) ── */
async function resolveRound() {
  // Calcule les hits
  const results = {};
  Object.entries(G.choices).forEach(([s,c])=>{
    results[s] = {...c, hit: c.move.heal ? true : Math.random()<c.move.acc};
  });
  G.choices = {};

  // Broadcast résultat
  broadcast({type:'round_result', results});
  await applyRound(results);
}

function onRoundResult(msg) {
  // Guest reçoit et applique
  if (!G.isHost) applyRound(msg.results);
}

async function applyRound(results) {
  G.phase = 'resolving';
  document.getElementById('waiting-action').style.display='none';

  // Tri par vitesse décroissante
  const order = Object.entries(results)
    .map(([s,r])=>({slot:+s,...r}))
    .sort((a,b)=>(G.players[b.slot]?.char.speed||0)-(G.players[a.slot]?.char.speed||0));

  for (const action of order) {
    const atk = G.players.find(p=>p.slot===action.slot);
    const tgt = G.players.find(p=>p.slot===action.targetSlot);
    if (!atk?.alive) continue;
    await applyOne(atk, tgt, action.move, action.hit);
    updateAllSprites();
    if (isOver()) { endGame(); return; }
    await delay(550);
  }

  G.phase = 'fight';
  renderActionPanel();
  addLog('— Nouveau round —','system');
}

async function applyOne(atk, tgt, move, hit) {
  if (!tgt) return;
  const isMe = atk.slot===G.mySlot;

  if (move.heal) {
    const gain = Math.min(move.heal, tgt.maxHP-tgt.hp);
    tgt.hp = Math.min(tgt.maxHP, tgt.hp+gain);
    addLog(`${atk.pseudo} soigne ${tgt.pseudo} +${gain} PV`, isMe?'me':'them');
  } else if (hit) {
    tgt.hp = Math.max(0, tgt.hp-move.dmg);
    if (!tgt.hp) tgt.alive = false;
    addLog(`${atk.pseudo} → ${move.icon} ${move.name} → ${tgt.pseudo} (${move.dmg} dmg)`, isMe?'me':'them');
    spawnHitParticles(tgt.slot);
    if (isMe) { const m=meshes[atk.slot]; if(m) { const anim={t:0}; G._atk=anim; } }
  } else {
    addLog(`${atk.pseudo} rate ${move.icon} ${move.name} !`, isMe?'me':'them');
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Fin de partie ── */
function isOver() {
  if (G.mode==='1v1'||G.mode==='ffa') return G.players.filter(p=>p.alive).length<=1;
  if (G.mode==='2v2') {
    return G.players.filter(p=>p.alive&&p.team===0).length===0
        || G.players.filter(p=>p.alive&&p.team===1).length===0;
  }
  return false;
}

function endGame() {
  G.phase='over';
  const me = G.players.find(p=>p.slot===G.mySlot);
  let txt = '';

  if (G.mode==='1v1'||G.mode==='ffa') {
    const winner = G.players.find(p=>p.alive);
    txt = winner?.slot===G.mySlot ? '🏆 Victoire !' : `💀 ${winner?.pseudo||'???'} gagne.`;
  } else {
    const myTeamAlive = G.players.some(p=>p.alive&&p.team===me?.team);
    txt = myTeamAlive ? '🏆 Votre équipe gagne !' : '💀 Votre équipe perd.';
  }

  document.getElementById('overlay').style.display='flex';
  document.getElementById('overlay-text').textContent=txt;
}

/* ── Rematch ── */
let _rematchAsked=false;

function askRematch() {
  if (_rematchAsked) return;
  _rematchAsked=true;
  const btn=document.querySelector('#overlay .btn');
  btn.textContent='⏳ En attente…'; btn.disabled=true;
  send({type:'rematch_ask'});
}

function onRematchAsk() {
  if (_rematchAsked) { send({type:'rematch_go'}); doRematch(); }
  else {
    document.querySelector('#overlay-text').textContent+='\n\nUn adversaire veut rejouer !';
    const btn=document.querySelector('#overlay .btn');
    btn.textContent='✅ Accepter'; btn.disabled=false;
    btn.onclick=()=>{ _rematchAsked=true; send({type:'rematch_go'}); doRematch(); };
  }
}

function doRematch() {
  _rematchAsked=false;
  document.getElementById('overlay').style.display='none';
  const btn=document.querySelector('#overlay .btn');
  btn.textContent='↺ Rejouer'; btn.disabled=false; btn.onclick=askRematch;

  // Reset
  Object.keys(charChoices).forEach(k=>delete charChoices[k]);
  G.choices={}; G.players=[];

  // Séparateur log
  const box=document.getElementById('combat-log-messages');
  if (box?.children.length) {
    const sep=document.createElement('div');
    sep.className='log-entry system';
    sep.innerHTML='<span class="log-badge">•</span><span class="log-text" style="color:var(--muted)">── Revanche ──</span>';
    box.appendChild(sep);
  }

  // Reset lobby ready
  G.lobbyPlayers.forEach(p=>p.ready=false);
  G.phase='lobby';
  renderLobby();
}
