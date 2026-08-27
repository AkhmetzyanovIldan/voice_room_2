import { Server } from 'socket.io';
import { getRoom, rooms } from '../roomsManager';
import { Room, Player } from '../models/types';
const { getVotePower, getClan } = require('../../server/roles');

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
  endGame: (roomId: string, winner?: string | null) => void;
  submitDayVote: (voterId: string, targetId: string) => void;
};

export function createGameEngine(io: Server) {
  // All functions operate on rooms via getRoom() and use the io instance.

  function emitRoomUpdate(roomId: string) {
    const room: Room | undefined = getRoom(roomId) as Room | undefined;
    if (!room) return;
    let currentSpeakerId: string | null = null;
    if (room.gameStatus === 'day_speeches' && room.turnOrder && room.turnOrder[room.currentTurnIndex]) {
      currentSpeakerId = room.turnOrder[room.currentTurnIndex].id;
    } else if (room.gameStatus === 'last_words') {
      currentSpeakerId = room.lastWordPlayerId;
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
      enabledRoles: room.enabledRoles,
      votes: room.votes || {},
      users: publicUsers,
      seats: room.seats,
      gameStatus: room.gameStatus,
      lastWordPlayerId: room.lastWordPlayerId,
      doctorSelfHealUsedLastNight: room.doctorSelfHealUsedLastNight,
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
    room.doctorSelfHealUsedLastNight = false;
    room.votes = {};
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
    room.nightActions = { mafiaTarget: null, doctorTarget: null, copTarget: null };
    room.nightActionActors = {};
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

    const doctor = Object.values(room.users).find((u) => u.role === 'doctor');
    room.doctorSelfHealUsedLastNight = !!doctor && doctorTarget === doctor.id;

    console.log(`resolveNight ${roomId}: mafia -> ${mafiaTarget}, doctor -> ${doctorTarget}, cop -> ${room.nightActions && room.nightActions.copTarget}`);

    if (mafiaTarget && mafiaTarget !== doctorTarget) {
      const victim = room.users[mafiaTarget];
      if (victim) {
        victim.isAlive = false;
        killedPlayerName = victim.username;
      }
    }

    const winner = checkVictory(room);
    io.to(roomId).emit('night-result', { killedPlayerName, winner });

    setTimeout(() => {
      if (winner) endGame(roomId, winner);
      else if (killedPlayerName && mafiaTarget) startLastWordPhase(roomId, mafiaTarget, 'speeches');
      else startDaySpeechesPhase(roomId);
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
        startDayVoting(roomId);
      }
    }, 1000) as unknown as NodeJS.Timeout;
  }

  function startDayVoting(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room) return;
    room.gameStatus = 'day_voting';
    room.votes = {};
    let timeLeft = 30;
    io.to(roomId).emit('voting-started', { timeLeft });
    emitRoomUpdate(roomId);
    clearInterval(room.timer);
    room.timer = setInterval(() => {
      timeLeft--;
      io.to(roomId).emit('timer-tick', { timeLeft: Math.max(timeLeft, 0) });
      if (timeLeft <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        resolveDayVote(roomId);
      }
    }, 1000) as unknown as NodeJS.Timeout;
  }

  function checkVictory(room: Room): 'mafia' | 'peaceful' | null {
    const alive = Object.values(room.users).filter((u) => u.seat !== null && u.isAlive);
    const mafiaPower = alive.filter((u) => getClan(u.role) === 'mafia')
      .reduce((sum, u) => sum + getVotePower(u.role), 0);
    const peacefulPower = alive.filter((u) => getClan(u.role) !== 'mafia')
      .reduce((sum, u) => sum + getVotePower(u.role), 0);
    if (mafiaPower === 0) return 'peaceful';
    if (alive.filter((u) => getClan(u.role) === 'mafia').length === 1 &&
      alive.filter((u) => getClan(u.role) !== 'mafia').length === 1) return 'mafia';
    if (mafiaPower >= peacefulPower) return 'mafia';
    return null;
  }

  function resolveDayVote(roomId: string) {
    const room = getRoom(roomId) as Room | undefined;
    if (!room || room.gameStatus !== 'day_voting') return;
    clearInterval(room.timer);
    room.timer = null;
    const counts: Record<string, number> = {};
    Object.entries(room.votes).forEach(([voterId, targetId]) => {
      const voter = room.users[voterId];
      const target = room.users[targetId];
      if (voter && voter.isAlive && target && target.isAlive) counts[targetId] = (counts[targetId] || 0) + 1;
    });
    const maxVotes = Math.max(0, ...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === maxVotes);
    const eliminated = leaders.length === 1 ? room.users[leaders[0]] : null;
    if (eliminated) eliminated.isAlive = false;
    const winner = checkVictory(room);
    io.to(roomId).emit('day-vote-result', {
      eliminatedPlayerName: eliminated ? eliminated.username : null,
      tie: leaders.length > 1,
      winner
    });
    if (winner) setTimeout(() => endGame(roomId, winner), 3000);
    else if (eliminated) setTimeout(() => startLastWordPhase(roomId, eliminated.id, 'night'), 3000);
    else setTimeout(() => startNightPhase(roomId), 3000);
  }

  function startLastWordPhase(roomId: string, playerId: string, nextPhase: 'night' | 'speeches') {
    const room = getRoom(roomId) as Room | undefined;
    const player = room && room.users[playerId];
    if (!room || !player) {
      if (nextPhase === 'night') startNightPhase(roomId);
      else startDaySpeechesPhase(roomId);
      return;
    }
    room.gameStatus = 'last_words';
    room.lastWordPlayerId = playerId;
    Object.values(room.users).forEach((u) => { u.mic = u.id === playerId; });
    let timeLeft = 15;
    io.to(roomId).emit('last-word-started', { playerId, playerName: player.username, timeLeft, nextPhase });
    emitRoomUpdate(roomId);
    clearInterval(room.timer);
    room.timer = setInterval(() => {
      timeLeft--;
      io.to(roomId).emit('timer-tick', { timeLeft: Math.max(timeLeft, 0) });
      if (timeLeft <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        player.mic = false;
        room.lastWordPlayerId = null;
        emitRoomUpdate(roomId);
        if (nextPhase === 'night') startNightPhase(roomId);
        else startDaySpeechesPhase(roomId);
      }
    }, 1000) as unknown as NodeJS.Timeout;
  }

  function submitDayVote(voterId: string, targetId: string) {
    const room = Array.from(rooms.values()).find((candidate) => candidate.users[voterId]);
    if (!room || room.gameStatus !== 'day_voting') return;
    const voter = room.users[voterId];
    const target = room.users[targetId];
    if (!voter || !voter.isAlive || voter.seat === null || !target || !target.isAlive || target.seat === null) return;
    // Голос нельзя менять или отдавать повторно в одной фазе.
    if (Object.prototype.hasOwnProperty.call(room.votes, voterId)) return;
    room.votes[voterId] = targetId;
    emitRoomUpdate(room.id);
    const alive = Object.values(room.users).filter((u) => u.seat !== null && u.isAlive);
    if (alive.every((u) => room.votes[u.id])) resolveDayVote(room.id);
  }

  function endGame(roomId: string, winner: string | null = null) {
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
    room.nightActionActors = {};
    room.turnOrder = [];
    room.currentTurnIndex = 0;
    room.lastWordPlayerId = null;

    io.to(roomId).emit('game-ended', { winner });
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
    endGame,
    submitDayVote
  };
}
