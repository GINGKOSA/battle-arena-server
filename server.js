const http  = require('http');
const https = require('https');
const url   = require('url');

const CLIENT_ID     = '1505615169185779782';
const CLIENT_SECRET = process.env.DISCORD_SECRET;
const REDIRECT_URI  = 'https://battle-arena-server-t781.onrender.com/callback';
const FRONTEND      = 'https://gingkosa.github.io/battle-arena-server';

const players = {};
const tokens  = {};
const sdps    = {};

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

setInterval(() => {
  const now = Date.now();
  Object.entries(players).forEach(([t,p]) => { if (now - p.lastSeen > 45000) { delete tokens[p.id]; delete players[t]; } });
  Object.entries(sdps).forEach(([k,v])    => { if (now - v.time    > 120000) delete sdps[k]; });
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

  /* ── API ── */
  if (p === '/me') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    me.lastSeen = Date.now(); json(res,{id:me.id,username:me.username,avatar:me.avatar}); return;
  }

  if (p === '/online') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    me.lastSeen = Date.now();
    json(res, Object.values(players).filter(x=>x.id!==me.id).map(x=>({id:x.id,username:x.username,avatar:x.avatar,busy:!!x.challenge}))); return;
  }

  if (p.startsWith('/challenge/') && req.method==='POST') {
    const me = getPlayer(req); if (!me) { json(res,{error:'unauthorized'},401); return; }
    const tid = p.split('/')[2], tt = tokens[tid];
    if (!tt||!players[tt]) { json(res,{error:'not_found'},404); return; }
    const target = players[tt];
    if (target.challenge?.fromId === me.id) {
      const room = randRoom();
      me.challenge = {accepted:true,room,isHost:true};
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
    const room = randRoom(), ct = tokens[me.challenge.fromId];
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
