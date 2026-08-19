import { Server } from 'socket.io';
import { getRoom } from '../roomsManager';
import { Room, Player } from '../models/types';

export type GameEngine = {
  emitRoomUpdate: (roomId: string) => void;
  startPlayingPhase: (roomId: string) => void;
  startGame: (roomId: string) => void;
  assignRoles: (players: Player[]) => void;
  startNightPhase: (roomId: string) => void;
  resolveNight: (roomId: string) => void;
  startDaySpeechesPhase: (roomId: string) => void;
  startNextTurn: (roomId: string) => void;
  startGeneralDiscussion: (roomId: string) => void;
  endGame: (roomId: string) => void;
};

export function createGameEngine(io: Server) {
  // All functions operate on rooms via getRoom() and use the io instance.

  function emitRoomUpdate(roomId: string) {
    const room: Room | undefined = getRoom(roomId) as Room | undefined;
    if (!room) return;
    let currentSpeakerId: string | null = null;
    if (room.gameStatus === 'day_speeches' && room.turnOrder && room.turnOrder[room.currentTurnIndex]) {
      currentSpeakerId = room.turnOrder[room.currentTurnIndex].id;
    }

    const publicUsers: Record<string, Partial<Player>> = {};
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

  function assignRoles(players: Player[]) {
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    const n = shuffled.length;
    if (n === 0) return;
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

  function startPlayingPhase(roomId: string) {
    startGame(roomId);
  }

  function startGame(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    const seated = Object.values(room.users).filter((u) => u.seat !== null) as Player[];
    if (seated.length === 0) return;
    room.nightActions = { mafiaTarget: null, doctorTarget: null, copTarget: null };
    assignRoles(seated);
    seated.forEach((player) => {
      io.to(player.id).emit('game-started', { role: player.role, status: 'night' });
    });
    room.gameStatus = 'night';
    io.to(roomId).emit('game-started', { roomStatus: room.gameStatus });
    emitRoomUpdate(roomId);
    startNightPhase(roomId);
  }

  function startNightPhase(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    room.gameStatus = 'night';
    let timeLeft = 30;
    console.log(`startNightPhase ${roomId}: starting night for ${Object.keys(room.users).length} users`);
    // Force all mics off on server-side authoritative state
    Object.values(room.users).forEach((u) => { u.mic = false; });
    io.to(roomId).emit('night-started', { timeLeft });
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
        resolveNight(roomId);
      }
    }, 1000) as unknown as NodeJS.Timeout;
  }

  function resolveNight(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    const { mafiaTarget, doctorTarget } = room.nightActions || {};
    let killedPlayerName: string | null = null;

    console.log(`resolveNight ${roomId}: mafia -> ${mafiaTarget}, doctor -> ${doctorTarget}, cop -> ${room.nightActions && room.nightActions.copTarget}`);

    if (mafiaTarget && mafiaTarget !== doctorTarget) {
      const victim = room.users[mafiaTarget];
      if (victim) {
        victim.isAlive = false;
        killedPlayerName = victim.username;
      }
    }

    io.to(roomId).emit('night-result', { killedPlayerName });

    setTimeout(() => {
      startDaySpeechesPhase(roomId);
    }, 5000);
  }

  function startDaySpeechesPhase(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    room.gameStatus = 'day_speeches';
    room.turnOrder = Object.values(room.users).filter((u) => u.seat !== null && u.isAlive) as Player[];
    room.currentTurnIndex = 0;
    emitRoomUpdate(roomId);
    startNextTurn(roomId);
  }

  function startNextTurn(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    if (!room.turnOrder || room.currentTurnIndex >= room.turnOrder.length) {
      startGeneralDiscussion(roomId);
      return;
    }

    const activePlayer = room.turnOrder[room.currentTurnIndex];
    let timeLeft = 15;
    console.log(`startNextTurn ${roomId}: active ${activePlayer && activePlayer.id}`);

    // Authoritative mic control: enable mic only for active player, disable for others
    Object.values(room.users).forEach((u) => {
      if (u.id === activePlayer.id && u.isAlive) u.mic = true;
      else u.mic = false;
    });
    emitRoomUpdate(roomId);

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
    }, 1000) as unknown as NodeJS.Timeout;
  }

  function startGeneralDiscussion(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    room.gameStatus = 'day_discussion';
    let timeLeft = 30;
    console.log(`startGeneralDiscussion ${roomId}: starting discussion`);
    io.to(roomId).emit('discussion-started', { timeLeft });
    // enable mics for all alive players
    Object.values(room.users).forEach((u) => {
      u.mic = !!u.isAlive;
    });
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
    }, 1000) as unknown as NodeJS.Timeout;
  }

  function endGame(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    console.log(`endGame ${roomId}: resetting game state`);
    room.gameStatus = 'waiting';
    Object.values(room.users).forEach((u) => {
      u.isReady = false;
      u.role = null;
      u.isAlive = false;
      u.mic = false;
    });
    room.nightActions = { mafiaTarget: null, doctorTarget: null, copTarget: null };
    room.turnOrder = [];
    room.currentTurnIndex = 0;

    io.to(roomId).emit('game-ended');
    emitRoomUpdate(roomId);
  }

  return {
    emitRoomUpdate,
    startPlayingPhase,
    startGame,
    assignRoles,
    startNightPhase,
    resolveNight,
    startDaySpeechesPhase,
    startNextTurn,
    startGeneralDiscussion,
    endGame
  };
}
