const http = require('http');
const https = require('https');
const url = require('url');

const CLIENT_ID     = '1505615169185779782';
const CLIENT_SECRET = process.env.DISCORD_SECRET;
const REDIRECT_URI  = 'https://battle-arena-server-t781.onrender.com/callback';
const FRONTEND      = 'https://gingkosa.github.io/battle-arena-server';

const rooms   = {};
const players = {};
const tokens  = {};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getBody(req) {
  return new Promise(res => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => res(body));
  });
}

function httpsPost(options, body) {
  return new Promise((res, rej) => {
    const req = https.request(options, r => {
      let data = '';
      r.on('data', d => data += d);
      r.on('end', () => { try { res(JSON.parse(data)); } catch { res({}); } });
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

function httpsGet(options) {
  return new Promise((res, rej) => {
    const req = https.request(options, r => {
      let data = '';
      r.on('data', d => data += d);
      r.on('end', () => { try { res(JSON.parse(data)); } catch { res({}); } });
    });
    req.on('error', rej);
    req.end();
  });
}

function randToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function randRoom() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function getPlayer(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  return token ? players[token] : null;
}

setInterval(() => {
  const now = Date.now();
  Object.keys(players).forEach(t => {
    if (now - players[t].lastSeen > 40000) {
      delete tokens[players[t].id];
      delete players[t];
    }
  });
  Object.keys(rooms).forEach(r => {
    if (now - rooms[r].time > 120000) delete rooms[r];
  });
}, 10000);

http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path   = parsed.pathname;

  if (req.method === 'OPTIONS') { cors(res); res.end(); return; }

  if (path === '/login') {
    const discordUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.writeHead(302, { Location: discordUrl });
    res.end();
    return;
  }

  if (path === '/callback') {
    const code = parsed.query.code;
    if (!code) {
      res.writeHead(302, { Location: FRONTEND + '/?error=no_code' });
      res.end();
      return;
    }
    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      }).toString();

      const tokenData = await httpsPost({
        hostname: 'discord.com',
        path: '/api/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      }, body);

      if (!tokenData.access_token) throw new Error('no token');

      const userData = await httpsGet({
        hostname: 'discord.com',
        path: '/api/users/@me',
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });

      const myToken = randToken();
      const avatar = userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(userData.discriminator || 0) % 5}.png`;

      players[myToken] = {
        id: userData.id,
        username: userData.global_name || userData.username,
        avatar,
        lastSeen: Date.now(),
        challenge: null
      };
      tokens[userData.id] = myToken;

      res.writeHead(302, { Location: `${FRONTEND}/?token=${myToken}` });
      res.end();
    } catch(e) {
      console.error('OAuth error:', e);
      res.writeHead(302, { Location: FRONTEND + '/?error=oauth_failed' });
      res.end();
    }
    return;
  }

  if (path === '/me' && req.method === 'GET') {
    const p = getPlayer(req);
    if (!p) { json(res, { error: 'unauthorized' }, 401); return; }
    p.lastSeen = Date.now();
    json(res, { id: p.id, username: p.username, avatar: p.avatar });
    return;
  }

  if (path === '/online' && req.method === 'GET') {
    const me = getPlayer(req);
    if (!me) { json(res, { error: 'unauthorized' }, 401); return; }
    me.lastSeen = Date.now();
    const list = Object.values(players)
      .filter(p => p.id !== me.id)
      .map(p => ({ id: p.id, username: p.username, avatar: p.avatar, challenged: !!p.challenge }));
    json(res, list);
    return;
  }

  if (path.startsWith('/challenge/') && req.method === 'POST') {
    const me = getPlayer(req);
    if (!me) { json(res, { error: 'unauthorized' }, 401); return; }
    const targetId = path.split('/')[2];
    const targetToken = tokens[targetId];
    if (!targetToken || !players[targetToken]) { json(res, { error: 'not_found' }, 404); return; }
    players[targetToken].challenge = { from: me.username, fromId: me.id, avatar: me.avatar };
    json(res, { ok: true });
    return;
  }

  if (path === '/challenged' && req.method === 'GET') {
    const me = getPlayer(req);
    if (!me) { json(res, { error: 'unauthorized' }, 401); return; }
    me.lastSeen = Date.now();
    json(res, { challenge: me.challenge });
    return;
  }

  if (path === '/accept' && req.method === 'POST') {
    const me = getPlayer(req);
    if (!me || !me.challenge) { json(res, { error: 'no_challenge' }, 400); return; }
    const room = randRoom();
    const challengerToken = tokens[me.challenge.fromId];
    if (challengerToken && players[challengerToken]) {
      players[challengerToken].challenge = { accepted: true, room };
    }
    me.challenge = null;
    json(res, { room });
    return;
  }

  if (path === '/decline' && req.method === 'POST') {
    const me = getPlayer(req);
    if (!me) { json(res, { error: 'unauthorized' }, 401); return; }
    if (me.challenge) {
      const challengerToken = tokens[me.challenge.fromId];
      if (challengerToken && players[challengerToken]) {
        players[challengerToken].challenge = { declined: true };
      }
    }
    me.challenge = null;
    json(res, { ok: true });
    return;
  }

// Ne traite comme room WebRTC que si c'est exactement 4 lettres majuscules
const room = path.slice(1).toUpperCase();
if (!room || !/^[A-Z]{4}(-OFFER|-ANSWER)?$/.test(room)) {
  cors(res); res.writeHead(404); res.end('Not found'); return;
}

  if (req.method === 'POST') {
    const body = await getBody(req);
    rooms[room] = { sdp: body, time: Date.now() };
    cors(res); res.end('ok');
    return;
  }

  if (req.method === 'GET') {
    const data = rooms[room];
    cors(res);
    if (data) { delete rooms[room]; res.end(data.sdp); }
    else res.end('');
    return;
  }

  cors(res); res.writeHead(404); res.end('Not found');

}).listen(process.env.PORT || 3000, () => {
  console.log('Battle Arena Server running on port', process.env.PORT || 3000);
});
