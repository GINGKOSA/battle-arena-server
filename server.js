const http = require('http');

const rooms = {};

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.end(); return; }

  const room = req.url.slice(1).toUpperCase();
  if (!room) { res.end('Battle Arena Signaling Server'); return; }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      rooms[room] = { sdp: body, time: Date.now() };
      res.end('ok');
    });
  }

  if (req.method === 'GET') {
    const data = rooms[room];
    if (data) { delete rooms[room]; res.end(data.sdp); }
    else res.end('');
  }
}).listen(process.env.PORT || 3000);
