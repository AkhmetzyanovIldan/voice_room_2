const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Server } = require('socket.io');
const config = require('./config');
const { GameEngine, GameError } = require('./engine');
const { evaluateVictory } = require('./roles');
const { createMedia } = require('./media');
const { telegramProfile, profile } = require('./auth');

function createApplication(options = {}) {
  const settings = { ...config, ...options.config };
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/vendor/livekit-client.js', (req, res) =>
    res.sendFile(require.resolve('livekit-client'))
  );
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = http.createServer(app),
    io = new Server(server, { maxHttpBufferSize: 32000 });
  const sessions = new Map(),
    clients = new Map();
  let closing = false;
  const personal = (id, event, data) => clients.get(id)?.emit(event, data);
  let media;
  const engine = new GameEngine({
    broadcast: (id, event, data) => io.to(id).emit(event, data),
    personal,
    victory: evaluateVictory,
    mediaChanged: (room) => media?.sync(room),
    ...options.engine,
  });
  media =
    options.media ||
    createMedia(settings, engine, (id) =>
      personal(id, 'media-error', 'Голосовая связь отключена. Подключите звук повторно.')
    );
  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      let verified = null;
      if (auth.initData && settings.BOT_TOKEN)
        verified = telegramProfile(auth.initData, settings.BOT_TOKEN);
      else if (settings.REQUIRE_TELEGRAM) throw new Error('Откройте игру через Telegram');
      const previous =
        (typeof auth.sessionToken === 'string' ? sessions.get(auth.sessionToken) : null) ||
        (verified
          ? [...sessions.values()].find((s) => s.telegramId === verified.telegramId)
          : null);
      if (previous?.telegramId && previous.telegramId !== verified?.telegramId)
        throw new Error('Сессия принадлежит другому пользователю');
      const s = previous || {
        id: randomUUID(),
        token: randomBytes(32).toString('hex'),
        roomId: null,
      };
      if (verified)
        Object.assign(s, { telegramId: verified.telegramId, profile: profile(verified) });
      s.lastSeen = Date.now();
      sessions.set(s.token, s);
      socket.data.session = s;
      next();
    } catch (e) {
      next(new Error(e.message));
    }
  });
  function current(socket) {
    const s = socket.data.session,
      room = engine.room(s.roomId);
    if (!room.users[s.id]) throw new GameError('Войдите в комнату заново');
    return room;
  }
  function sync(socket, room, resumed = false) {
    const id = socket.data.session.id;
    socket.emit('room-joined', { roomId: room.id, roomName: room.name, playerId: id, resumed });
    socket.emit('private-state', engine.privateState(room, id));
    engine.update(room);
  }
  async function leave(socket) {
    const s = socket.data.session,
      room = engine.rooms.get(s.roomId);
    s.roomId = null;
    if (!room) return;
    socket.leave(room.id);
    clearTimeout(room.users[s.id]?.disconnectTimer);
    engine.remove(room, s.id);
    await media.remove(room, s.id);
  }
  io.on('connection', (socket) => {
    const s = socket.data.session,
      id = s.id,
      old = clients.get(id);
    clients.set(id, socket);
    if (old && old !== socket) {
      old.emit('session-replaced');
      old.disconnect(true);
    }
    socket.emit('session', { sessionToken: s.token, playerId: id });
    const restored = engine.rooms.get(s.roomId);
    if (restored?.users[id]) {
      clearTimeout(restored.users[id].disconnectTimer);
      engine.join(restored, id, {});
      socket.join(restored.id);
      sync(socket, restored, true);
    } else {
      s.roomId = null;
      socket.emit('room-left');
    }
    let bucket = Date.now(),
      count = 0;
    function on(name, fn, ack) {
      socket.on(name, async (payload) => {
        try {
          if (clients.get(id) !== socket) return;
          if (Date.now() - bucket > 1000) {
            bucket = Date.now();
            count = 0;
          }
          if (++count > 30) throw new GameError('Слишком много действий, подождите секунду');
          if (payload === null) throw new GameError('Некорректный запрос');
          s.lastSeen = Date.now();
          await fn(payload);
        } catch (e) {
          const message = e instanceof GameError ? e.message : 'Не удалось выполнить действие';
          if (ack) socket.emit(ack, { accepted: false, reason: message });
          socket.emit('error-msg', message);
          if (!(e instanceof GameError)) console.error(`Event ${name}: ${e.name}`);
        }
      });
    }
    function join(room, payload) {
      socket.join(room.id);
      s.roomId = room.id;
      engine.join(room, id, s.profile || profile(payload));
      sync(socket, room);
    }
    on('create-room', (p = {}) => {
      if (s.roomId) throw new GameError('Сначала выйдите из текущей комнаты');
      join(engine.create(p), p);
    });
    on('join-room', (p = {}) => {
      if (typeof p.roomId !== 'string' || !/^[1-9]\d{3}$/.test(p.roomId))
        throw new GameError('Комната не найдена');
      const room = engine.room(p.roomId);
      if (s.roomId && s.roomId !== room.id)
        throw new GameError('Сначала выйдите из текущей комнаты');
      if (room.users[id]) return sync(socket, room, true);
      join(room, p);
    });
    on('leave-room', async () => {
      await leave(socket);
      socket.emit('room-left');
    });
    on('take-seat', (seat) => engine.takeSeat(current(socket), id, seat));
    on('leave-seat', () => engine.leaveSeat(current(socket), id));
    on('set-ready', () => engine.ready(current(socket), id));
    on('toggle-media', ({ mic } = {}) => {
      const room = current(socket),
        u = room.users[id];
      if (typeof mic !== 'boolean') throw new GameError('Некорректное состояние микрофона');
      if (mic && !engine.canSpeak(room, u)) throw new GameError('Сейчас говорить нельзя');
      u.mic = mic;
      engine.update(room);
    });
    on('get-livekit-token', async () => {
      const room = current(socket),
        data = await media.token(room, room.users[id]);
      if (s.roomId === room.id) socket.emit('livekit-token', { ...data, roomId: room.id });
    });
    on('media-ready', async ({ channel } = {}) => {
      const room = current(socket),
        u = room.users[id];
      if (!channel || channel !== engine.mediaChannel(room, u))
        throw new GameError('Голосовой канал уже изменился');
      u.mediaChannel = channel;
      u.mediaConnected = true;
      u.mediaPermission = null;
      await media.sync(room);
      if (s.roomId === room.id) engine.update(room);
    });
    on(
      'night-action',
      ({ targetId, actionType, revision, targetIds } = {}) =>
        engine.act(current(socket), id, targetId, actionType, revision, targetIds),
      'night-action-ack'
    );
    on(
      'day-vote',
      ({ targetId, revision } = {}) => engine.vote(current(socket), id, targetId, revision),
      'day-vote-ack'
    );
    on('send-chat-message', (text) => {
      const room = current(socket),
        u = room.users[id];
      if (!engine.canChat(room, u)) throw new GameError('Чат сейчас недоступен');
      if (typeof text !== 'string' || !text.trim() || text.length > 150)
        throw new GameError('Сообщение должно содержать от 1 до 150 символов');
      const message = {
        channel: room.gameStatus === 'night' ? 'mafia' : 'room',
        username: u.username,
        text: text.trim(),
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      };
      if (message.channel === 'mafia') {
        for (const receiver of Object.values(room.users))
          if (engine.canChat(room, receiver)) personal(receiver.id, 'chat-message', message);
      } else io.to(room.id).emit('chat-message', message);
    });
    socket.on('disconnect', () => {
      if (closing) return;
      if (clients.get(id) !== socket) return;
      clients.delete(id);
      const room = engine.rooms.get(s.roomId),
        u = room?.users[id];
      if (!u) return;
      Object.assign(u, {
        connected: false,
        mic: false,
        isReady: false,
        disconnectDeadline: Date.now() + settings.RECONNECT_GRACE_MS,
      });
      engine.update(room);
      u.disconnectTimer = setTimeout(() => {
        if (!u.connected && engine.rooms.get(room.id) === room) {
          engine.remove(room, id);
          media.remove(room, id);
          if (s.roomId === room.id) s.roomId = null;
        }
      }, settings.RECONNECT_GRACE_MS);
    });
  });
  const cleanup = setInterval(() => {
    for (const [token, s] of sessions)
      if (!s.roomId && !clients.has(s.id) && Date.now() - s.lastSeen > 86400000)
        sessions.delete(token);
  }, 60000);
  cleanup.unref();
  return {
    app,
    server,
    io,
    engine,
    close: async () => {
      closing = true;
      clearInterval(cleanup);
      for (const room of engine.rooms.values())
        for (const u of Object.values(room.users)) clearTimeout(u.disconnectTimer);
      engine.close();
      await new Promise((resolve) => io.close(resolve));
    },
  };
}
module.exports = { createApplication };
