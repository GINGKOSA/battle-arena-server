const http  = require('http');
const https = require('https');
const url   = require('url');

const CLIENT_ID     = '1505615169185779782';
const CLIENT_SECRET = process.env.DISCORD_SECRET;
const REDIRECT_URI  = 'https://battle-arena-server-t781.onrender.com/callback';
const FRONTEND      = 'https://gingkosa.github.io/battle-arena-server';

const players = {};  // token → player
const tokens  = {};  // discordId → token
const sdps    = {};  // key → {sdp, time}
const lobbies = {};  // roomId → {hostId, hostName, avatar, room, slots, mode, createdAt}

const cors = res => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
};

const json = (res, data, status = 200) => {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

const readBody = req => new Promise(ok => {
  let b = '';
  req.on('data', d => b += d);
  req.on('end', () => ok(b));
});

const httpsReq = (opts, payload) => new Promise((ok, fail) => {
  const r = https.request(opts, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => { try { ok(JSON.parse(d)); } catch { ok({}); } });
  });
  r.on('error', fail);
  if (payload) r.write(payload);
  r.end();
});

const rand     = (n = 16) => Math.random().toString(36).slice(2).padEnd(n, '0').slice(0, n);
const randRoom = () => Array.from({length:4}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random()*23)]).join('');
const getPlayer = req => { const t = (req.headers.authorization || '').replace('Bearer ','').trim(); return players[t] || null; };

// Nettoyage périodique
setInterval(() => {
  const now = Date.now();
  Object.entries(players).forEach(([t,p]) => {
    if (now - p.lastSeen > 45000) {
      // Fermer le lobby de ce joueur s'il en avait un
      Object.keys(lobbies).forEach(r => { if (lobbies[r].hostId === p.id) delete lobbies[r]; });
      delete tokens[p.id];
      delete players[t];
    }
  });
  Object.entries(sdps).forEach(([k,v]) => { if (now - v.time > 120000) delete sdps[k]; });
  // Nettoyer les vieux lobbies (> 30 min)
  Object.entries(lobbies).forEach(([r,l]) => { if (now - l.createdAt > 1800000) delete lobbies[r]; });
}, 15000);

http.createServer(async (req, res) => {
  const { pathname: p, query: q } = url.parse(req.url, true);

  if (req.method === 'OPTIONS') { cors(res); res.end(); return; }

  /* ── OAuth ── */
  if (p === '/login') {
    res.writeHead(302, { Location: `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify` });
    res.end(); return;
  }

  if (p === '/callback') {
    if (!q.code) { res.writeHead(302, { Location: `${FRONTEND}/?error=no_code` }); res.end(); return; }
    try {
      const b = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code: q.code, redirect_uri: REDIRECT_URI }).toString();
      const td = await httpsReq({ hostname:'discord.com', path:'/api/oauth2/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(b)} }, b);
      if (!td.access_token) throw 0;
      const ud = await httpsReq({ hostname:'discord.com', path:'/api/users/@me', headers:{ Authorization:`Bearer ${td.access_token}` } });
      const token  = rand();
      const avatar = ud.avatar ? `https://cdn.discordapp.com/avatars/${ud.id}/${ud.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(ud.discriminator||0)%5}.png`;
      players[token] = { id: ud.id, username: ud.global_name || ud.username, avatar, lastSeen: Date.now(), challenge: null };
      tokens[ud.id]  = token;
      res.writeHead(302, { Location: `${FRONTEND}/?token=${token}` }); res.end();
    } catch { res.writeHead(302, { Location: `${FRONTEND}/?error=oauth_failed` }); res.end(); }
    return;
  }

  /* ── API joueurs ── */
  if (p === '/me') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    me.lastSeen = Date.now(); json(res,{id:me.id,username:me.username,avatar:me.avatar}); return;
  }

  if (p === '/online') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    me.lastSeen = Date.now();
    json(res, Object.values(players)
      .filter(x => x.id !== me.id)
      .map(x => ({ id:x.id, username:x.username, avatar:x.avatar, busy:!!x.challenge }))
    ); return;
  }

  /* ── API Lobbies ── */

  // Créer un lobby public
  if (p === '/lobby/create' && req.method === 'POST') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    const body = JSON.parse(await readBody(req) || '{}');
    // Fermer l'ancien lobby de cet hôte s'il existe
    Object.keys(lobbies).forEach(r => { if (lobbies[r].hostId === me.id) delete lobbies[r]; });
    const room = randRoom();
    lobbies[room] = {
      hostId:    me.id,
      hostName:  me.username,
      avatar:    me.avatar,
      room,
      maxSlots:  body.maxSlots  || 2,
      mode:      body.mode      || '1v1',
      players:   [me.id],
      createdAt: Date.now(),
    };
    me.lobby = room;
    json(res, { room }); return;
  }

  // Lister les lobbies ouverts
  if (p === '/lobby/list') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    me.lastSeen = Date.now();
    const open = Object.values(lobbies)
      .filter(l => l.hostId !== me.id && l.players.length < l.maxSlots)
      .map(l => ({
        room:      l.room,
        hostName:  l.hostName,
        avatar:    l.avatar,
        mode:      l.mode,
        slots:     l.players.length,
        maxSlots:  l.maxSlots,
      }));
    json(res, open); return;
  }

  // Rejoindre un lobby (envoie un challenge à l'hôte)
  if (p.startsWith('/lobby/join/') && req.method === 'POST') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    const room   = p.split('/')[3];
    const lobby  = lobbies[room];
    if (!lobby) { json(res,{error:'lobby_not_found'},404); return; }
    if (lobby.players.length >= lobby.maxSlots) { json(res,{error:'lobby_full'},400); return; }
    // Envoyer un challenge auto à l'hôte
    const ht = tokens[lobby.hostId];
    if (!ht || !players[ht]) { json(res,{error:'host_offline'},404); return; }
    const host = players[ht];
    // Si l'hôte a déjà reçu ce challenge → accepter directement
    if (host.challenge?.fromId === me.id) {
      const r = lobby.room;
      host.challenge   = { accepted:true, room:r, isHost:true };
      const myChallenge = { accepted:true, room:r, isHost:false };
      lobby.players.push(me.id);
      json(res, myChallenge); return;
    }
    // Sinon notifier l'hôte
    host.challenge = { from:me.username, fromId:me.id, avatar:me.avatar, lobbyRoom:room };
    json(res, { waiting:true, room }); return;
  }

  // Fermer son lobby
  if (p === '/lobby/close' && req.method === 'POST') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    Object.keys(lobbies).forEach(r => { if (lobbies[r].hostId === me.id) delete lobbies[r]; });
    me.lobby = null;
    json(res, {ok:true}); return;
  }

  /* ── Challenge (gardé pour compat) ── */
  if (p.startsWith('/challenge/') && req.method==='POST') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    const tid = p.split('/')[2], tt = tokens[tid];
    if (!tt||!players[tt]) { json(res,{error:'not_found'},404); return; }
    const target = players[tt];
    if (target.challenge?.fromId === me.id) {
      const room = randRoom();
      me.challenge     = {accepted:true,room,isHost:true};
      target.challenge = {accepted:true,room,isHost:false};
      json(res,{ok:true}); return;
    }
    target.challenge = {from:me.username,fromId:me.id,avatar:me.avatar};
    json(res,{ok:true}); return;
  }

  if (p === '/challenged') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    me.lastSeen = Date.now(); json(res,{challenge:me.challenge}); return;
  }

  if (p === '/accept' && req.method==='POST') {
    const me = getPlayer(req); if (!me?.challenge) { json(res,{error:'no_challenge'},400); return; }
    if (me.challenge.accepted) { const r={room:me.challenge.room,isHost:me.challenge.isHost}; me.challenge=null; json(res,r); return; }
    const room = me.challenge.lobbyRoom || randRoom();
    const ct = tokens[me.challenge.fromId];
    if (ct&&players[ct]) players[ct].challenge = {accepted:true,room,isHost:true};
    me.challenge=null; json(res,{room,isHost:false}); return;
  }

  if (p === '/decline' && req.method==='POST') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    if (me.challenge?.fromId) { const ct=tokens[me.challenge.fromId]; if(ct&&players[ct]) players[ct].challenge={declined:true}; }
    me.challenge=null; json(res,{ok:true}); return;
  }

  /* ── Signaling WebRTC ── */
  const key = p.slice(1).toUpperCase();
  if (!key) { cors(res); res.end('Battle Arena OK'); return; }

  if (req.method==='POST') { const b=await readBody(req); sdps[key]={sdp:b,time:Date.now()}; cors(res); res.end('ok'); return; }
  if (req.method==='GET')  { cors(res); const e=sdps[key]; if(e){delete sdps[key];res.end(e.sdp);}else res.end(''); return; }

  cors(res); res.writeHead(404); res.end();
}).listen(process.env.PORT||3000, ()=>console.log('Server:', process.env.PORT||3000));
