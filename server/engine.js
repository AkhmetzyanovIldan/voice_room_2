const { randomInt, randomUUID } = require('node:crypto');
const { ROLE_DEFINITIONS, getClan } = require('./roles');
const ROLE_ACTIONS = {
  mafia: ['mafia_kill'],
  don: ['don_check', 'mafia_kill'],
  lawyer: ['lawyer_check'],
  cop: ['cop_check'],
  doctor: ['doctor_heal'],
  sergeant: ['sergeant_kill'],
  journalist: ['journalist_check'],
  mistress: ['mistress_charm'],
  civilian: [],
};

const DURATIONS = {
  night: 20,
  night_result: 5,
  day_speeches: 15,
  day_discussion: 30,
  day_voting: 30,
  vote_result: 3,
  last_words: 15,
};

class GameError extends Error {}

class GameEngine {
  constructor({
    broadcast,
    personal,
    victory,
    mediaChanged = () => {},
    now = Date.now,
    durations = {},
    minPlayers = 3,
  }) {
    this.rooms = new Map();
    Object.assign(this, { broadcast, personal, victory, mediaChanged, now, minPlayers });
    this.durations = { ...DURATIONS, ...durations };
  }

  room(id) {
    const room = this.rooms.get(id);
    if (!room) throw new GameError('Комната не найдена');
    return room;
  }

  create({ roomName, maxSeats = 6, hasChat = true, enabledRoles = ['mafia', 'cop', 'doctor'] }) {
    if (!Number.isInteger(Number(maxSeats)) || Number(maxSeats) < 3 || Number(maxSeats) > 12)
      throw new GameError('За столом должно быть от 3 до 12 мест');
    if (typeof hasChat !== 'boolean') throw new GameError('Некорректная настройка чата');
    if (
      !Array.isArray(enabledRoles) ||
      enabledRoles.some((r) => !ROLE_DEFINITIONS.some((role) => role.id === r))
    )
      throw new GameError('Неизвестная роль');
    if (!enabledRoles.some((r) => r === 'mafia' || r === 'don'))
      throw new GameError('Для игры нужна мафия или дон');
    if (new Set(enabledRoles).size > Number(maxSeats))
      throw new GameError('Ролей больше, чем мест за столом');
    if (this.rooms.size >= 9000) throw new GameError('Все комнаты заняты, попробуйте позже');
    let id;
    do {
      id = String(randomInt(1000, 10000));
    } while (this.rooms.has(id));
    const room = {
      id,
      mediaRoom: `mafia-${randomUUID()}`,
      name: String(roomName || 'Комната').slice(0, 60),
      maxSeats: Number(maxSeats),
      hasChat,
      enabledRoles: [...new Set(enabledRoles)],
      users: {},
      seats: Array(Number(maxSeats)).fill(null),
      gameStatus: 'waiting',
      round: 0,
      revision: 0,
      deadline: null,
      timer: null,
      turnOrder: [],
      currentTurnIndex: 0,
      votes: {},
      nightActions: {},
      nightActionActors: {},
      doctorSelfHealUsedLastNight: false,
      lastWordPlayerId: null,
      result: null,
      roster: [],
      checks: {},
      hostId: null,
    };
    this.rooms.set(id, room);
    return room;
  }

  join(room, id, profile) {
    let user = room.users[id];
    if (!user) {
      user = room.users[id] = {
        id,
        ...profile,
        seat: null,
        mic: false,
        isReady: false,
        isAlive: false,
        role: null,
      };
      if (!room.hostId) room.hostId = id;
    }
    user.connected = true;
    user.disconnectDeadline = null;
    return user;
  }

  alive(room) {
    return Object.values(room.users).filter((u) => u.seat !== null && u.isAlive);
  }
  speaker(room) {
    return room.gameStatus === 'last_words'
      ? room.lastWordPlayerId
      : room.gameStatus === 'day_speeches'
        ? room.turnOrder[room.currentTurnIndex] || null
        : null;
  }
  canSpeak(room, user) {
    if (!user || !user.connected || user.seat === null) return false;
    if (room.gameStatus === 'waiting') return true;
    if (room.gameStatus === 'last_words') return room.lastWordPlayerId === user.id;
    if (!user.isAlive) return false;
    return (
      (room.gameStatus === 'night' && getClan(user.role) === 'mafia') ||
      room.gameStatus === 'day_discussion' ||
      (room.gameStatus === 'day_speeches' && this.speaker(room) === user.id)
    );
  }
  canChat(room, user) {
    return (
      !!user?.connected &&
      (room.gameStatus === 'waiting'
        ? room.hasChat
        : room.gameStatus === 'night' &&
          user.seat !== null &&
          user.isAlive &&
          getClan(user.role) === 'mafia')
    );
  }
  mediaChannel(room, user) {
    if (!user?.connected) return null;
    if (room.gameStatus === 'night')
      return user.seat !== null && getClan(user.role) === 'mafia' ? 'mafia' : null;
    return room.gameStatus === 'night_result' ? null : 'room';
  }

  snapshot(room) {
    const users = {};
    for (const u of Object.values(room.users)) {
      const { id, username, photoUrl, seat, mic, isReady, isAlive, connected } = u;
      users[id] = {
        id,
        username,
        photoUrl,
        seat,
        mic: room.gameStatus === 'night' ? false : mic,
        isReady,
        isAlive,
        connected,
        canSpeak: room.gameStatus === 'night' ? false : this.canSpeak(room, u),
        canVote: isAlive && seat !== null && u.voteBlockedRound !== room.round,
      };
    }
    return {
      roomId: room.id,
      roomName: room.name,
      maxSeats: room.maxSeats,
      hasChat: room.hasChat,
      enabledRoles: room.enabledRoles,
      hostId: room.hostId,
      users,
      seats: room.seats,
      gameStatus: room.gameStatus,
      round: room.round,
      revision: room.revision,
      deadline: room.deadline,
      timeLeft: room.deadline ? Math.max(0, Math.ceil((room.deadline - this.now()) / 1000)) : 0,
      currentSpeakerId: this.speaker(room),
      lastWordPlayerId: room.lastWordPlayerId,
      votes: room.votes,
      result: room.result,
    };
  }

  update(room) {
    for (const user of Object.values(room.users)) {
      if (!this.canSpeak(room, user)) user.mic = false;
    }
    for (const u of Object.values(room.users))
      this.personal(u.id, 'private-state', this.privateState(room, u.id));
    this.broadcast(room.id, 'update-room', this.snapshot(room));
    this.mediaChanged(room);
  }
  privateState(room, id) {
    const u = room.users[id];
    const submitted = room.nightActionActors[id] || {};
    const actions =
      u?.isAlive && u.nightBlockedRound !== room.round
        ? (ROLE_ACTIONS[u.role] || []).filter(
            (a) => !submitted[a] && (a !== 'sergeant_kill' || (!u.shotUsed && room.round > 1))
          )
        : [];
    return {
      canSpeak: this.canSpeak(room, u),
      mic: !!u?.mic,
      canChat: this.canChat(room, u),
      mediaChannel: this.mediaChannel(room, u),
      role: u?.role || null,
      actions,
      submitted,
      doctorSelfHealUsedLastNight: u?.role === 'doctor' && room.doctorSelfHealUsedLastNight,
      blocked: u?.nightBlockedRound === room.round,
      checks: room.checks[id] || [],
      teammates:
        getClan(u?.role) === 'mafia'
          ? Object.values(room.users)
              .filter((p) => getClan(p.role) === 'mafia')
              .map((p) => p.id)
          : [],
    };
  }

  enter(room, phase, next, event, payload = {}) {
    clearTimeout(room.timer);
    room.revision++;
    room.gameStatus = phase;
    if (phase === 'night' || phase === 'vote_result') room.victoryPhase = 'night';
    else if (['night_result', 'day_speeches', 'day_discussion', 'day_voting'].includes(phase))
      room.victoryPhase = 'day';
    room.lastWordPlayerId = phase === 'last_words' ? room.lastWordPlayerId : null;
    const seconds = this.durations[phase];
    room.deadline = next ? this.now() + seconds * 1000 : null;
    const revision = room.revision;
    if (next)
      room.timer = setTimeout(() => {
        if (this.rooms.get(room.id) === room && room.revision === revision) next();
      }, seconds * 1000);
    else room.timer = null;
    if (event) this.broadcast(room.id, event, { ...payload, timeLeft: seconds, round: room.round });
    this.update(room);
  }

  takeSeat(room, id, seat) {
    if (room.gameStatus !== 'waiting')
      throw new GameError('Места можно менять только до начала партии');
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.maxSeats)
      throw new GameError('Некорректное место');
    if (room.seats[seat] !== null) throw new GameError('Это место уже занято');
    const u = room.users[id];
    if (u.seat !== null) room.seats[u.seat] = null;
    room.seats[seat] = id;
    Object.assign(u, { seat, mic: false, isReady: false });
    this.update(room);
  }
  leaveSeat(room, id) {
    if (room.gameStatus !== 'waiting')
      throw new GameError('Во время партии можно только выйти из комнаты');
    const u = room.users[id];
    if (u.seat !== null) room.seats[u.seat] = null;
    Object.assign(u, { seat: null, mic: false, isReady: false });
    this.update(room);
  }
  ready(room, id) {
    const u = room.users[id];
    if (room.gameStatus !== 'waiting' || u.seat === null)
      throw new GameError('Сначала займите место за столом');
    u.isReady = !u.isReady;
    const seated = Object.values(room.users).filter((p) => p.seat !== null);
    if (
      seated.length >= Math.max(this.minPlayers, room.enabledRoles.length) &&
      seated.every((p) => p.isReady && p.connected)
    )
      this.start(room);
    else this.update(room);
  }
  start(room) {
    const players = Object.values(room.users).filter((u) => u.seat !== null);
    if (room.gameStatus !== 'waiting' || players.length < this.minPlayers)
      throw new GameError('Недостаточно игроков');
    const deck = [...room.enabledRoles];
    if (deck.length > players.length) throw new GameError('Ролей больше, чем игроков');
    while (deck.length < players.length) deck.push('civilian');
    const proposed = {
      round: 1,
      gameStatus: 'night',
      users: Object.fromEntries(deck.map((role, i) => [i, { role, isAlive: true, seat: i }])),
    };
    if (this.victory(proposed)) {
      for (const p of players) p.isReady = false;
      this.update(room);
      throw new GameError(
        'При таком составе победитель определён до начала игры. Добавьте мирных игроков или измените состав ролей.'
      );
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    room.checks = {};
    room.result = null;
    room.round = 0;
    room.doctorSelfHealUsedLastNight = false;
    players.forEach((p, i) => {
      Object.assign(p, {
        role: deck[i],
        isAlive: true,
        isReady: false,
        mic: false,
        shotUsed: false,
        voteBlockedRound: null,
        nightBlockedRound: null,
      });
      this.personal(p.id, 'game-started', { role: p.role, status: 'night' });
    });
    room.roster = players.map((p) => ({
      id: p.id,
      username: p.username,
      photoUrl: p.photoUrl,
      role: p.role,
      seat: p.seat,
    }));
    this.night(room);
  }
  night(room) {
    room.round++;
    room.nightActions = {};
    room.nightActionActors = {};
    room.votes = {};
    room.result = null;
    this.enter(room, 'night', () => this.resolveNight(room), 'night-started');
    for (const u of Object.values(room.users))
      this.personal(u.id, 'private-state', this.privateState(room, u.id));
  }
  act(room, id, targetId, actionType, revision, targetIds) {
    if (room.gameStatus !== 'night' || revision !== room.revision || this.now() >= room.deadline)
      throw new GameError('Эта ночь уже закончилась');
    const actor = room.users[id],
      target = room.users[targetId];
    if (!actor?.isAlive || actor.seat === null || !target?.isAlive || target.seat === null)
      throw new GameError('Нужен живой игрок за столом');
    if (room.nightActionActors[id]?.[actionType]) throw new GameError('Это действие уже принято');
    if (!this.privateState(room, id).actions.includes(actionType))
      throw new GameError('Это действие сейчас недоступно');
    if (targetId === id && actor.role !== 'doctor') throw new GameError('Нельзя выбрать себя');
    if (actor.role === 'doctor' && targetId === id && room.doctorSelfHealUsedLastNight)
      throw new GameError('Нельзя лечить себя две ночи подряд');
    if (actionType === 'mafia_kill' && getClan(target.role) === 'mafia')
      throw new GameError('Нельзя стрелять в свой клан');
    if (actionType === 'journalist_check') {
      if (
        !Array.isArray(targetIds) ||
        targetIds.length !== 2 ||
        new Set(targetIds).size !== 2 ||
        !targetIds.includes(targetId) ||
        targetIds.some((t) => !room.users[t]?.isAlive || room.users[t].seat === null || t === id)
      )
        throw new GameError('Выберите двух разных живых игроков');
    }
    (room.nightActionActors[id] ||= {})[actionType] = { targetId, targetIds };
    if (actionType === 'sergeant_kill') actor.shotUsed = true;
    this.personal(id, 'night-action-ack', { actionType, targetId, accepted: true });
    this.personal(id, 'private-state', this.privateState(room, id));
  }
  resolveNight(room) {
    if (room.gameStatus !== 'night') return;
    const actions = Object.entries(room.nightActionActors).filter(
      ([id]) => room.users[id]?.isAlive
    );
    const shots = {},
      heals = new Set(),
      attacks = new Set(),
      journals = [];
    room.doctorSelfHealUsedLastNight = false;
    for (const [id, choices] of actions) {
      for (const [type, choice] of Object.entries(choices)) {
        const target = room.users[choice.targetId];
        if (!target?.isAlive || target.seat === null) continue;
        if (type === 'mafia_kill') shots[target.id] = (shots[target.id] || 0) + 1;
        else if (type === 'sergeant_kill') attacks.add(target.id);
        else if (type === 'doctor_heal') {
          heals.add(target.id);
          room.doctorSelfHealUsedLastNight = target.id === id;
        } else if (type === 'mistress_charm') {
          target.voteBlockedRound = room.round;
          target.nightBlockedRound = room.round + 1;
          this.personal(target.id, 'charmed', { round: room.round });
        } else if (type === 'journalist_check') journals.push({ id, targets: choice.targetIds });
        else {
          const result = { round: room.round, targetName: target.username, actionType: type };
          if (type === 'cop_check') result.isMafia = getClan(target.role) === 'mafia';
          if (type === 'don_check') result.isCop = target.role === 'cop';
          if (type === 'lawyer_check') result.role = target.role;
          (room.checks[id] ||= []).push(result);
          this.personal(id, 'investigation-result', result);
        }
      }
    }
    const high = Math.max(0, ...Object.values(shots)),
      leaders = Object.keys(shots).filter((id) => shots[id] === high);
    if (leaders.length === 1) attacks.add(leaders[0]);
    for (const id of heals)
      this.personal(id, 'healed', { round: room.round, saved: attacks.has(id) });
    const killed = [...attacks]
      .filter((id) => !heals.has(id))
      .map((id) => room.users[id])
      .filter((u) => u?.isAlive);
    killed.forEach((u) => {
      u.isAlive = false;
    });
    const headlines = journals
      .filter((j) => room.users[j.id]?.isAlive && j.targets.every((id) => room.users[id]))
      .map((j) => ({
        names: j.targets.map((id) => room.users[id].username),
        sameClan: getClan(room.users[j.targets[0]].role) === getClan(room.users[j.targets[1]].role),
      }));
    const winner = this.victory(room, 'day');
    const result = {
      killedPlayerName: killed.map((u) => u.username).join(', ') || null,
      killedPlayers: killed.map((u) => u.id),
      headlines,
      winner,
    };
    room.result = { type: 'night', ...result };
    this.enter(
      room,
      'night_result',
      () => {
        if (winner) this.end(room, winner);
        else
          this.lastWords(
            room,
            killed.map((u) => u.id),
            () => this.speeches(room)
          );
      },
      'night-result',
      result
    );
    for (const u of Object.values(room.users))
      this.personal(u.id, 'private-state', this.privateState(room, u.id));
  }
  speeches(room) {
    room.result = null;
    room.turnOrder = this.alive(room)
      .sort((a, b) => a.seat - b.seat)
      .map((u) => u.id);
    room.currentTurnIndex = 0;
    this.turn(room);
  }
  turn(room) {
    while (room.currentTurnIndex < room.turnOrder.length) {
      const u = room.users[room.turnOrder[room.currentTurnIndex]];
      if (u?.isAlive && u.connected) break;
      room.currentTurnIndex++;
    }
    if (room.currentTurnIndex >= room.turnOrder.length) return this.discussion(room);
    const id = room.turnOrder[room.currentTurnIndex];
    this.enter(
      room,
      'day_speeches',
      () => {
        room.currentTurnIndex++;
        this.turn(room);
      },
      'turn-changed',
      { activePlayerId: id }
    );
  }
  discussion(room) {
    this.enter(room, 'day_discussion', () => this.voting(room), 'discussion-started');
  }
  voting(room) {
    room.votes = {};
    this.enter(room, 'day_voting', () => this.resolveVote(room), 'voting-started');
    if (!this.alive(room).some((u) => u.voteBlockedRound !== room.round)) this.resolveVote(room);
  }
  vote(room, id, targetId, revision) {
    if (
      room.gameStatus !== 'day_voting' ||
      room.revision !== revision ||
      this.now() >= room.deadline
    )
      throw new GameError('Голосование уже закрыто');
    const voter = room.users[id],
      target = room.users[targetId];
    if (!voter?.isAlive || voter.seat === null || voter.voteBlockedRound === room.round)
      throw new GameError('Вы не можете голосовать');
    if (targetId !== null && (!target?.isAlive || target.seat === null || targetId === id))
      throw new GameError('Выберите другого живого игрока или пропустите');
    if (Object.hasOwn(room.votes, id)) throw new GameError('Голос уже принят');
    room.votes[id] = targetId;
    this.personal(id, 'day-vote-ack', { targetId, accepted: true });
    if (
      this.alive(room)
        .filter((u) => u.voteBlockedRound !== room.round)
        .every((u) => Object.hasOwn(room.votes, u.id))
    )
      this.resolveVote(room);
    else this.update(room);
  }
  resolveVote(room) {
    if (room.gameStatus !== 'day_voting') return;
    const counts = {};
    for (const [id, target] of Object.entries(room.votes)) {
      if (target && room.users[id]?.isAlive && room.users[target]?.isAlive)
        counts[target] = (counts[target] || 0) + 1;
    }
    const max = Math.max(0, ...Object.values(counts));
    const leaders = Object.keys(counts).filter((id) => counts[id] === max);
    const eliminated = leaders.length === 1 ? room.users[leaders[0]] : null;
    if (eliminated) eliminated.isAlive = false;
    const winner = this.victory({ ...room, round: room.round + 1 }, 'night');
    const result = {
      eliminatedPlayerName: eliminated?.username || null,
      tie: leaders.length > 1,
      winner,
    };
    room.result = { type: 'vote', ...result };
    this.enter(
      room,
      'vote_result',
      () => {
        if (winner) this.end(room, winner);
        else if (eliminated) this.lastWord(room, eliminated.id, () => this.night(room));
        else this.night(room);
      },
      'day-vote-result',
      result
    );
  }
  lastWord(room, id, next) {
    const u = room.users[id];
    if (!u?.connected) return next();
    room.lastWordPlayerId = id;
    this.enter(room, 'last_words', next, 'last-word-started', {
      playerId: id,
      playerName: u.username,
    });
  }
  lastWords(room, ids, next) {
    if (!ids.length) return next();
    this.lastWord(room, ids[0], () => this.lastWords(room, ids.slice(1), next));
  }
  end(room, winner) {
    const roster = room.roster.map((p) => ({
      ...p,
      isAlive: !!room.users[p.id]?.isAlive,
      connected: !!room.users[p.id]?.connected,
    }));
    room.result = { type: 'game', winner, players: roster };
    room.votes = {};
    room.nightActions = {};
    room.nightActionActors = {};
    room.checks = {};
    for (const u of Object.values(room.users))
      Object.assign(u, { role: null, isAlive: false, isReady: false, mic: false });
    this.enter(room, 'waiting', null, 'game-ended', { winner, players: roster });
  }
  remove(room, id) {
    const u = room.users[id];
    if (!u) return;
    if (u.seat !== null) room.seats[u.seat] = null;
    delete room.users[id];
    if (room.hostId === id) room.hostId = Object.keys(room.users)[0] || null;
    if (!Object.keys(room.users).length) {
      clearTimeout(room.timer);
      this.rooms.delete(room.id);
      return;
    }
    if (room.gameStatus !== 'waiting') {
      const winner = this.victory(room);
      if (winner) return this.end(room, winner);
      if (room.gameStatus === 'day_speeches' && this.speaker(room) === id) {
        room.currentTurnIndex++;
        return this.turn(room);
      }
    }
    this.update(room);
  }
  close() {
    for (const room of this.rooms.values()) clearTimeout(room.timer);
  }
}

module.exports = { GameEngine, GameError };
