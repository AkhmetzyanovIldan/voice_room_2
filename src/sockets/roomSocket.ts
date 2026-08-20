import { Server } from 'socket.io';
import { getRoom, createRoom, hasRoom, deleteRoom } from '../roomsManager';
import { Room, Player } from '../models/types';

// LiveKit token generation
const { AccessToken } = require('livekit-server-sdk');
const config = require('../../server/config');

import { GameEngine } from '../game/gameEngine';

export function registerRoomSocket(io: Server, gameEngine: GameEngine) {
  function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  io.on('connection', (socket: any) => {
    console.log('socket connected', socket.id);

    socket.on('get-livekit-token', async ({ username, roomId }: any) => {
      try {
        if (!config || !config.LK_API_KEY || !config.LK_API_SECRET || !config.LIVEKIT_URL) {
          console.warn('LiveKit config missing, returning null token');
          socket.emit('livekit-token', { token: null, url: null });
          return;
        }

        const identity = `${username || 'guest'}_${socket.id}`;
        const at = new AccessToken(config.LK_API_KEY, config.LK_API_SECRET, { identity });
        at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
        const token = await at.toJwt();
        socket.emit('livekit-token', { token, url: config.LIVEKIT_URL });
      } catch (err) {
        console.error('livekit token error', err);
        socket.emit('livekit-token', { token: null, url: null });
      }
    });

    socket.on('create-room', ({ roomName, username, photoUrl, maxSeats, hasChat, enabledRoles }: any) => {
      let roomId = generateRoomCode();
      while (hasRoom(roomId)) { roomId = generateRoomCode(); }

      const max = parseInt(maxSeats) || 6;
      const room = createRoom(roomId, {
        name: roomName || 'Комната',
        maxSeats: max,
        hasChat: hasChat !== undefined ? hasChat : true,
        enabledRoles: Array.isArray(enabledRoles) ? enabledRoles : ['mafia', 'cop', 'doctor']
      });

      joinRoomLogic(socket, roomId, username, photoUrl);
    });

    socket.on('join-room', ({ roomId, username, photoUrl }: any) => {
      if (!hasRoom(roomId)) {
        socket.emit('error-msg', 'Комната не найдена!');
        return;
      }
      joinRoomLogic(socket, roomId, username, photoUrl);
    });

    function joinRoomLogic(socket: any, roomId: string, username: string, photoUrl: string) {
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.username = username || 'Гость';
      socket.data.photoUrl = photoUrl || '';

      const room = getRoom(roomId) as Room | undefined;
      if (!room) return;
      room.users[socket.id] = {
        id: socket.id,
        username: socket.data.username,
        photoUrl: socket.data.photoUrl,
        seat: null,
        mic: false,
        isReady: false,
        isAlive: false,
        role: null
      } as Player;

      socket.emit('room-joined', { roomId, roomName: room.name });
      gameEngine.emitRoomUpdate(roomId);
    }

    socket.on('take-seat', (seatIndex: number) => {
      const roomId = socket.data.roomId;
      if (!roomId || !hasRoom(roomId)) return;
      const room = getRoom(roomId) as Room | undefined;
      if (!room) return;
      if (room.gameStatus !== 'waiting') return;

      if (room.seats[seatIndex] === null) {
        for (let i = 0; i < room.maxSeats; i++) if (room.seats[i] === socket.id) room.seats[i] = null;
        room.seats[seatIndex] = socket.id;
        room.users[socket.id].seat = seatIndex;
        room.users[socket.id].mic = true;
        gameEngine.emitRoomUpdate(roomId);
      }
    });

    socket.on('leave-seat', () => {
      const roomId = socket.data.roomId;
      if (!roomId || !hasRoom(roomId)) return;
      const room = getRoom(roomId) as Room | undefined;
      if (!room) return;
      if (room.gameStatus !== 'waiting') return;

      for (let i = 0; i < room.maxSeats; i++) if (room.seats[i] === socket.id) room.seats[i] = null;
      if (room.users[socket.id]) {
        room.users[socket.id].seat = null;
        room.users[socket.id].mic = false;
        room.users[socket.id].isReady = false;
      }
      gameEngine.emitRoomUpdate(roomId);
    });

    socket.on('set-ready', () => {
      const roomId = socket.data.roomId;
      if (!roomId || !hasRoom(roomId)) return;
      const room = getRoom(roomId) as Room | undefined;
      if (!room) return;
      if (room.gameStatus !== 'waiting') return;
      const user = room.users[socket.id];
      if (user && user.seat !== null) {
        user.isReady = !user.isReady;
        gameEngine.emitRoomUpdate(roomId);
        const seatedUsers = Object.values(room.users).filter((u) => u.seat !== null);
        if (seatedUsers.length > 0 && seatedUsers.every((u) => u.isReady)) {
          gameEngine.startPlayingPhase(roomId);
        }
      }
    });

    socket.on('toggle-media', ({ mic }: any) => {
      const roomId = socket.data.roomId;
      if (!roomId || !hasRoom(roomId)) return;
      const room = getRoom(roomId) as Room | undefined;
      if (!room) return;
      const user = room.users[socket.id];
      if (!user || user.seat === null) return;

      if (room.gameStatus === 'last_words') {
        if (room.lastWordPlayerId !== socket.id) return;
      } else if (room.gameStatus === 'day_speeches') {
        const activePlayer = room.turnOrder && room.turnOrder[room.currentTurnIndex];
        if (!activePlayer) return;
        if (activePlayer.id !== socket.id) return;
      } else if (room.gameStatus === 'day_discussion' || room.gameStatus === 'waiting') {
        // allowed
      } else {
        return;
      }

      user.mic = mic;
      gameEngine.emitRoomUpdate(roomId);
    });

    socket.on('night-action', ({ roomId, targetId, actionType }: any) => {
      const room = getRoom(roomId) as Room | undefined;
      if (!room || room.gameStatus !== 'night') return;

      const actor = room.users[socket.id];
      if (!actor || !actor.isAlive) return;

      const target = room.users[targetId];
      if (!target) return;

      let accepted = false;
      if (room.nightActionActors[socket.id]) {
        socket.emit('night-action-ack', { actionType, targetId, accepted: false, reason: 'already-acted' });
        return;
      }
      if (actionType === 'mafia_kill') {
        if (actor.role === 'mafia') { room.nightActions.mafiaTarget = targetId; accepted = true; }
      }
      if (actionType === 'doctor_heal') {
        if (actor.role === 'doctor') { room.nightActions.doctorTarget = targetId; accepted = true; }
      }
      if (actionType === 'cop_check') {
        if (actor.role === 'cop') {
          room.nightActions.copTarget = targetId;
          accepted = true;
        }
      }

      if (accepted) {
        room.nightActionActors[socket.id] = true;
        if (actionType === 'cop_check') {
          socket.emit('cop-result', { targetName: target.username, isMafia: target.role === 'mafia' });
        }
      }
      console.log(`night-action from ${socket.id} (${actor && actor.role}) action=${actionType} target=${targetId} accepted=${accepted}`);
      socket.emit('night-action-ack', { actionType, targetId, accepted });
    });

    socket.on('day-vote', ({ targetId }: any) => {
      gameEngine.submitDayVote(socket.id, targetId);
    });

    socket.on('send-chat-message', (text: string) => {
      const roomId = socket.data.roomId;
      if (!roomId || !hasRoom(roomId)) return;
      io.to(roomId).emit('chat-message', {
        username: socket.data.username,
        text: text.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (roomId && hasRoom(roomId)) {
        const room = getRoom(roomId) as Room | undefined;
        if (!room) return;
        for (let i = 0; i < room.maxSeats; i++) if (room.seats[i] === socket.id) room.seats[i] = null;
        delete room.users[socket.id];

        if (Object.keys(room.users).length === 0) {
          clearInterval(room.timer);
          deleteRoom(roomId);
        } else {
          gameEngine.emitRoomUpdate(roomId);
        }
      }
    });
  });
}
