const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createApplication } = require('../server/index');
function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(`Timeout: ${event}`)), 3000);
    socket.once(event, (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}
test('real sockets: room lifecycle, rejected requests, private role and reconnect', async (t) => {
  const app = createApplication({
    config: { RECONNECT_GRACE_MS: 100 },
    media: {
      token: async () => ({ token: null, url: null }),
      sync: async () => {},
      remove: async () => {},
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.disconnect());
    await app.close();
  });
  async function connect(auth = {}) {
    const c = io(url, { autoConnect: false, transports: ['websocket'], auth });
    clients.push(c);
    const p = once(c, 'session');
    c.connect();
    return { c, s: await p };
  }
  const { c: a, s: session } = await connect();
  let p = once(a, 'error-msg');
  a.emit('join-room', { roomId: '0000' });
  assert.match(await p, /не найдена/);
  p = once(a, 'room-joined');
  a.emit('create-room', { maxSeats: 3, hasChat: false, enabledRoles: ['mafia', 'doctor'] });
  const joined = await p;
  p = once(a, 'error-msg');
  a.emit('send-chat-message', 'not broadcast');
  assert.match(await p, /недоступен/);
  p = once(a, 'update-room');
  a.emit('take-seat', 0);
  await p;
  const { c: b } = await connect();
  p = once(b, 'error-msg');
  b.emit('get-livekit-token', { roomId: joined.roomId });
  assert.match(await p, /не найдена/);
  p = once(b, 'room-joined');
  b.emit('join-room', { roomId: joined.roomId, username: 'B' });
  await p;
  p = once(b, 'update-room');
  b.emit('take-seat', 1);
  await p;
  const { c: c } = await connect();
  p = once(c, 'room-joined');
  c.emit('join-room', { roomId: joined.roomId, username: 'C' });
  await p;
  p = once(c, 'update-room');
  c.emit('take-seat', 2);
  await p;
  const rolePromise = once(a, 'game-started');
  a.emit('set-ready');
  b.emit('set-ready');
  c.emit('set-ready');
  const role = await rolePromise;
  assert.ok(role.role);
  a.disconnect();
  const restored = io(url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { sessionToken: session.sessionToken },
  });
  clients.push(restored);
  const ready = once(restored, 'room-joined'),
    priv = once(restored, 'private-state');
  restored.connect();
  assert.equal((await ready).playerId, session.playerId);
  assert.equal((await priv).role, role.role);
  assert.equal(app.engine.room(joined.roomId).users[session.playerId].seat, 0);
  p = once(restored, 'room-left');
  restored.emit('leave-room');
  await p;
  assert.equal(app.engine.room(joined.roomId).users[session.playerId], undefined);
});

test('night chat is delivered only to living mafia; dead mafia and spectators cannot send', async (t) => {
  const app = createApplication({ config: { LIVEKIT_URL: '', LK_API_KEY: '', LK_API_SECRET: '' } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const clients = [],
    sessions = [],
    received = [];
  t.after(async () => {
    clients.forEach((c) => c.disconnect());
    await app.close();
  });
  for (let i = 0; i < 6; i++) {
    const c = io(`http://127.0.0.1:${app.server.address().port}`, {
      autoConnect: false,
      transports: ['websocket'],
    });
    clients.push(c);
    received.push([]);
    c.on('chat-message', (d) => received[i].push(d));
    const session = once(c, 'session');
    c.connect();
    sessions.push(await session);
  }
  let joined = once(clients[0], 'room-joined');
  clients[0].emit('create-room', { maxSeats: 6, hasChat: false });
  const { roomId } = await joined;
  for (const c of clients.slice(1)) {
    joined = once(c, 'room-joined');
    c.emit('join-room', { roomId });
    await joined;
  }
  const room = app.engine.room(roomId);
  for (const [i, role] of ['mafia', 'lawyer', 'don', 'doctor', 'civilian', null].entries()) {
    Object.assign(room.users[sessions[i].playerId], {
      role,
      isAlive: i !== 2,
      seat: role ? i : null,
    });
  }
  room.gameStatus = 'night';
  const delivered = once(clients[1], 'chat-message');
  clients[0].emit('send-chat-message', 'Тест закрытого канала');
  assert.equal((await delivered).channel, 'mafia');
  for (let i = 2; i < clients.length; i++) {
    const denied = once(clients[i], 'error-msg');
    clients[i].emit('send-chat-message', 'Запрещённое сообщение');
    assert.match(await denied, /недоступен/);
  }
  assert.equal(received[0].length, 1);
  assert.equal(received[1].length, 1);
  assert.ok(received.slice(2).every((messages) => messages.length === 0));
  const denied = once(clients[3], 'error-msg');
  clients[3].emit('media-ready', { channel: 'mafia' });
  assert.match(await denied, /канал уже изменился/);
});
