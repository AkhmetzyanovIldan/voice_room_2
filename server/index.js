const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { AccessToken } = require('livekit-server-sdk');

const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files from root/public
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory rooms store (legacy behavior)
const rooms = {};

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('get-livekit-token', async ({ username, roomId }) => {
    const identity = `${username}_${socket.id}`;
    const at = new AccessToken(config.LK_API_KEY, config.LK_API_SECRET, { identity });
    at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();
    // отправляем токен и URL LiveKit-кластера клиенту
    socket.emit('livekit-token', { token, url: config.LIVEKIT_URL });
  });

  socket.on('create-room', ({ roomName, username, photoUrl, maxSeats, hasChat }) => {
    let roomId = generateRoomCode();
    while (rooms[roomId]) { roomId = generateRoomCode(); }

    const seats = {};
    const max = parseInt(maxSeats) || 6;
    for (let i = 0; i < max; i++) seats[i] = null;

    rooms[roomId] = {
      name: roomName || 'Комната',
      maxSeats: max,
      hasChat: hasChat !== undefined ? hasChat : true,
      users: {},
      seats: seats,
      gameStatus: 'waiting',
      currentTurnIndex: 0,
      turnOrder: [],
      timer: null,
      // Mafia game state (initialized for game usage)
      nightActions: { mafiaTarget: null, doctorTarget: null, copTarget: null }
    };

    joinRoomLogic(socket, roomId, username, photoUrl);
  });

  socket.on('join-room', ({ roomId, username, photoUrl }) => {
    if (!rooms[roomId]) {
      socket.emit('error-msg', 'Комната не найдена!');
      return;
    }
    joinRoomLogic(socket, roomId, username, photoUrl);
  });

  function joinRoomLogic(socket, roomId, username, photoUrl) {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username || 'Гость';
    socket.data.photoUrl = photoUrl || '';

    const room = rooms[roomId];
    room.users[socket.id] = {
      id: socket.id,
      username: socket.data.username,
      photoUrl: socket.data.photoUrl,
      seat: null,
      mic: false,
      isReady: false
    };

    socket.emit('room-joined', { roomId, roomName: room.name });
    emitRoomUpdate(roomId);
  }

  socket.on('take-seat', (seatIndex) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.gameStatus !== 'waiting') return;

    if (room.seats[seatIndex] === null) {
      for (let i = 0; i < room.maxSeats; i++) if (room.seats[i] === socket.id) room.seats[i] = null;
      room.seats[seatIndex] = socket.id;
      room.users[socket.id].seat = seatIndex;
      room.users[socket.id].mic = true;
      emitRoomUpdate(roomId);
    }
  });

  socket.on('leave-seat', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.gameStatus !== 'waiting') return;

    for (let i = 0; i < room.maxSeats; i++) if (room.seats[i] === socket.id) room.seats[i] = null;
    if (room.users[socket.id]) {
      room.users[socket.id].seat = null;
      room.users[socket.id].mic = false;
      room.users[socket.id].isReady = false;
    }
    emitRoomUpdate(roomId);
  });

  socket.on('set-ready', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.gameStatus !== 'waiting') return;
    const user = room.users[socket.id];
    if (user && user.seat !== null) {
      user.isReady = !user.isReady;
      emitRoomUpdate(roomId);
      const seatedUsers = Object.values(room.users).filter(u => u.seat !== null);
      if (seatedUsers.length > 0 && seatedUsers.every(u => u.isReady)) {
        startPlayingPhase(roomId);
      }
    }
  });

  socket.on('toggle-media', ({ mic }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const user = room.users[socket.id];
    // Только сидящие за столом могут переключать микрофон (наблюдатели — нет)
    if (!user || user.seat === null) return;

    // Правила:
    // - В фазе 'day_speeches' менять состояние микрофона может только текущий активный игрок.
    // - В фазе 'day_discussion' или 'waiting' — любой сидящий может менять свой микрофон.
    // - В фазе 'night' — никто не может включать микрофон (тихая ночь).
    if (room.gameStatus === 'day_speeches') {
      const activePlayer = room.turnOrder && room.turnOrder[room.currentTurnIndex];
      if (!activePlayer) return;
      if (activePlayer.id !== socket.id) {
        // Игрок неактивен — отклоняем запрос
        return;
      }
    } else if (room.gameStatus === 'day_discussion' || room.gameStatus === 'waiting') {
      // разрешено
    } else {
      // ночь или неизвестное состояние — запрещаем переключать микрофон
      return;
    }

    // Если дошли сюда — разрешаем переключить микрофон для запрашивающего пользователя
    user.mic = mic;
    emitRoomUpdate(roomId);
  });

  // Ночные действия (мафия, врач, комиссар)
  socket.on('night-action', ({ roomId, targetId, actionType }) => {
    const room = rooms[roomId];
    if (!room || room.gameStatus !== 'night') return;

    const actor = room.users[socket.id];
    if (!actor || !actor.isAlive) return; // только живые игроки действуют

    const target = room.users[targetId];
    if (!target) return;

    // actionType может быть: 'mafia_kill', 'doctor_heal', 'cop_check'
    // Проверяем, что отправитель имеет право совершать действие этой роли
    let accepted = false;
    if (actionType === 'mafia_kill') {
      if (actor.role === 'mafia') { room.nightActions.mafiaTarget = targetId; accepted = true; }
    }
    if (actionType === 'doctor_heal') {
      if (actor.role === 'doctor') { room.nightActions.doctorTarget = targetId; accepted = true; }
    }
    if (actionType === 'cop_check') {
      if (actor.role === 'cop') {
        room.nightActions.copTarget = targetId;
        socket.emit('cop-result', { isMafia: !!(target && target.role === 'mafia') });
        accepted = true;
      }
    }

    console.log(`night-action from ${socket.id} (${actor && actor.role}) action=${actionType} target=${targetId} accepted=${accepted}`);

    // send ack only to the actor (private)
    socket.emit('night-action-ack', { actionType, targetId, accepted });
  });

  socket.on('send-chat-message', (text) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    io.to(roomId).emit('chat-message', {
      username: socket.data.username,
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      for (let i = 0; i < room.maxSeats; i++) if (room.seats[i] === socket.id) room.seats[i] = null;
      delete room.users[socket.id];

      if (Object.keys(room.users).length === 0) {
        clearInterval(room.timer);
        delete rooms[roomId];
      } else {
        emitRoomUpdate(roomId);
      }
    }
  });
});

function emitRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  let currentSpeakerId = null;
  if (room.gameStatus === 'day_speeches' && room.turnOrder && room.turnOrder[room.currentTurnIndex]) {
    currentSpeakerId = room.turnOrder[room.currentTurnIndex].id;
  }
  // sanitize users to avoid leaking private role information
  const publicUsers = {};
  Object.entries(room.users).forEach(([sid, u]) => {
    publicUsers[sid] = {
      id: u.id,
      username: u.username,
      photoUrl: u.photoUrl,
      seat: u.seat,
      mic: u.mic,
      isReady: u.isReady,
      isAlive: !!u.isAlive
    };
  });

  io.to(roomId).emit('update-room', {
    roomName: room.name,
    maxSeats: room.maxSeats,
    hasChat: room.hasChat,
    users: publicUsers,
    seats: room.seats,
    gameStatus: room.gameStatus,
    currentSpeakerId: currentSpeakerId
  });
}

function startPlayingPhase(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // Use mafia-style game start: assign roles and begin the night phase
  startGame(roomId);
}

function startTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.currentTurnIndex >= room.turnOrder.length) { startDiscussionPhase(roomId); return; }
  const activePlayer = room.turnOrder[room.currentTurnIndex];
  let timeLeft = 15;
  io.to(roomId).emit('turn-changed', { activePlayerId: activePlayer.id, timeLeft });
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) io.to(roomId).emit('timer-tick', { timeLeft });
    else { clearInterval(room.timer); room.currentTurnIndex++; startTurn(roomId); }
  }, 1000);
}

// --- Mafia game helper functions ---
function assignRoles(players) {
  // players: array of user objects (sitting players)
  const shuffled = [...players].sort(() => 0.5 - Math.random());
  const n = shuffled.length;
  if (n === 0) return;

  // Basic distribution used here (can be improved later):
  // If at least 3 players: 1 mafia, 1 cop, 1 doctor, rest civilians
  // If 2 players: 1 mafia, 1 civilian
  // If 1 player: civilian
  shuffled.forEach((player, idx) => {
    if (n >= 3) {
      if (idx === 0) player.role = 'mafia';
      else if (idx === 1) player.role = 'cop';
      else if (idx === 2) player.role = 'doctor';
      else player.role = 'civilian';
    } else if (n === 2) {
      if (idx === 0) player.role = 'mafia';
      else player.role = 'civilian';
    } else {
      player.role = 'civilian';
    }
    player.isAlive = true;
  });
}

function startGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // collect seated players
  const seated = Object.values(room.users).filter(u => u.seat !== null);
  if (seated.length === 0) return;

  // reset night actions
  room.nightActions = { mafiaTarget: null, doctorTarget: null, copTarget: null };

  // assign roles
  assignRoles(seated);

  // notify each player privately about their role
  seated.forEach(player => {
    io.to(player.id).emit('game-started', { role: player.role, status: 'night' });
  });

  // update room status and clients
  room.gameStatus = 'night';
  // broadcast to room that the game started (clients may also receive personal role via private event)
  io.to(roomId).emit('game-started', { roomStatus: room.gameStatus });
  emitRoomUpdate(roomId);

  // start night phase timer
  startNightPhase(roomId);
}

function startNightPhase(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameStatus = 'night';
  let timeLeft = 30;

  console.log(`startNightPhase ${roomId}: starting night for ${Object.keys(room.users).length} users`);
  io.to(roomId).emit('night-started', { timeLeft });

  clearInterval(room.timer);
  room.timer = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) {
      io.to(roomId).emit('timer-tick', { timeLeft });
    } else {
      // emit final tick 0 so clients can update UI consistently
      io.to(roomId).emit('timer-tick', { timeLeft: 0 });
      clearInterval(room.timer);
      room.timer = null;
      resolveNight(roomId);
    }
  }, 1000);
}

function resolveNight(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const { mafiaTarget, doctorTarget } = room.nightActions || {};
  let killedPlayerName = null;

  console.log(`resolveNight ${roomId}: mafia -> ${mafiaTarget}, doctor -> ${doctorTarget}, cop -> ${room.nightActions && room.nightActions.copTarget}`);

  if (mafiaTarget && mafiaTarget !== doctorTarget) {
    const victim = room.users[mafiaTarget];
    if (victim) {
      victim.isAlive = false;
      killedPlayerName = victim.username;
    }
  }

  io.to(roomId).emit('night-result', { killedPlayerName });

  // short pause to show result, then go to day speeches
  setTimeout(() => {
    startDaySpeechesPhase(roomId);
  }, 5000);
}

function startDaySpeechesPhase(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameStatus = 'day_speeches';
  // turn order = alive seated players
  room.turnOrder = Object.values(room.users).filter(u => u.seat !== null && u.isAlive);
  room.currentTurnIndex = 0;
  emitRoomUpdate(roomId);
  startNextTurn(roomId);
}

function startNextTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (!room.turnOrder || room.currentTurnIndex >= room.turnOrder.length) {
    startGeneralDiscussion(roomId);
    return;
  }

  const activePlayer = room.turnOrder[room.currentTurnIndex];
  let timeLeft = 15;
  console.log(`startNextTurn ${roomId}: active ${activePlayer && activePlayer.id}`);
  io.to(roomId).emit('turn-changed', { activePlayerId: activePlayer.id, timeLeft });

  clearInterval(room.timer);
  room.timer = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) {
      io.to(roomId).emit('timer-tick', { timeLeft });
    } else {
      io.to(roomId).emit('timer-tick', { timeLeft: 0 });
      clearInterval(room.timer);
      room.timer = null;
      room.currentTurnIndex++;
      startNextTurn(roomId);
    }
  }, 1000);
}

function startGeneralDiscussion(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.gameStatus = 'day_discussion';
  let timeLeft = 30;
  console.log(`startGeneralDiscussion ${roomId}: starting discussion`);
  io.to(roomId).emit('discussion-started', { timeLeft });
  emitRoomUpdate(roomId);

  clearInterval(room.timer);
  room.timer = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) {
      io.to(roomId).emit('timer-tick', { timeLeft });
    } else {
      io.to(roomId).emit('timer-tick', { timeLeft: 0 });
      clearInterval(room.timer);
      room.timer = null;
      endGame(roomId);
    }
  }, 1000);
}

// keep startDiscussionPhase as a compatibility wrapper
function startDiscussionPhase(roomId) { startGeneralDiscussion(roomId); }

function endGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  console.log(`endGame ${roomId}: resetting game state`);
  room.gameStatus = 'waiting';
  // reset readiness and role/alive state
  Object.values(room.users).forEach(u => {
    u.isReady = false;
    u.role = null;
    u.isAlive = false;
  });
  // clear game internals
  room.nightActions = { mafiaTarget: null, doctorTarget: null, copTarget: null };
  room.turnOrder = [];
  room.currentTurnIndex = 0;

  io.to(roomId).emit('game-ended');
  emitRoomUpdate(roomId);
}

const PORT = config.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
