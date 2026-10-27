// Servidor do PADRÃO Online — sem dependências (só Node.js 14+).
// Serve o jogo (index.html) e repassa as jogadas entre os dois jogadores de cada sala.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = process.env.PORT || 8000;
const rooms = new Map();

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ'; let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(ok => {
  let d = ''; req.on('data', c => { d += c; if (d.length > 2e5) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch (e) { ok({}); } });
});
const emit = (p, ev, data) => { if (p.res) p.res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
const online = room => room.players.filter(p => p.res).length;
const broadcast = (room, ev, data) => room.players.forEach(p => emit(p, ev, data));
const resetGame = room => { room.inGame = false; room.moves = 0; room.turn = 'P1'; room.occupied.clear(); };
function find(b) {
  const room = rooms.get(String(b.room || '').toUpperCase());
  const player = room && room.players.find(p => p.pid === b.pid);
  return { room, player };
}

const routes = {
  '/api/create': async () => {
    const code = newCode(), pid = rid();
    rooms.set(code, { code, players: [{ pid, slot: 'P1', res: null }], turn: 'P1', occupied: new Set(), inGame: false, moves: 0, created: Date.now() });
    return [200, { room: code, pid, slot: 'P1' }];
  },
  '/api/join': async b => {
    const room = rooms.get(String(b.room || '').toUpperCase());
    if (!room) return [404, { error: 'Sala não encontrada. Confira o código.' }];
    if (room.players.length >= 2) return [409, { error: 'Sala cheia.' }];
    const slot = room.players.some(p => p.slot === 'P1') ? 'P2' : 'P1';
    const pid = rid(); room.players.push({ pid, slot, res: null });
    return [200, { room: room.code, pid, slot }];
  },
  '/api/start': async b => {
    const { room, player } = find(b);
    if (!player) return [404, { error: 'Sala inválida.' }];
    if (online(room) < 2) return [409, { error: 'Aguardando o oponente.' }];
    if (room.inGame && room.moves === 0) return [200, { ok: true }];      // já existe uma partida nova esperando
    resetGame(room); room.inGame = true;
    broadcast(room, 'start', b.config || {});
    return [200, { ok: true }];
  },
  '/api/move': async b => {
    const { room, player } = find(b);
    if (!player || !room.inGame) return [409, { error: 'Partida não iniciada.' }];
    const r = b.r | 0, c = b.c | 0, k = r * 15 + c;
    if (player.slot !== room.turn) return [409, { error: 'Não é a sua vez.' }];
    if (r < 0 || r > 14 || c < 0 || c > 14 || room.occupied.has(k)) return [409, { error: 'Jogada inválida.' }];
    room.occupied.add(k); room.moves++; room.turn = room.turn === 'P1' ? 'P2' : 'P1';
    broadcast(room, 'move', { r, c, slot: player.slot });
    return [200, { ok: true }];
  }
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && routes[url.pathname]) {
    const [code, obj] = await routes[url.pathname](await readBody(req));
    return json(res, code, obj);
  }
  if (req.method === 'GET' && url.pathname === '/api/ping') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const { room, player } = find({ room: url.searchParams.get('room'), pid: url.searchParams.get('pid') });
    if (!player) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': ok\n\n'); player.res = res;
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    broadcast(room, 'peers', { n: online(room) });
    req.on('close', () => {
      clearInterval(ping); player.res = null;
      room.players = room.players.filter(p => p !== player);
      resetGame(room);
      if (!room.players.length) rooms.delete(room.code); else broadcast(room, 'peers', { n: online(room) });
    });
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(path.join(__dirname, 'index.html'), (e, data) => {
      if (e) { res.writeHead(500); return res.end('index.html não encontrado ao lado do server.js'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data);
    });
  }
  res.writeHead(404); res.end('Não encontrado');
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  PADRÃO Online rodando!\n');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log(`  Na rede (LAN):     http://${i.address}:${PORT}   <- passe este endereço aos outros jogadores`));
  console.log('\n  Para parar: Ctrl + C\n');
});
// limpa salas abandonadas (criadas e nunca conectadas)
setInterval(() => { for (const [k, r] of rooms) if (!online(r) && Date.now() - r.created > 120000) rooms.delete(k); }, 60000);
