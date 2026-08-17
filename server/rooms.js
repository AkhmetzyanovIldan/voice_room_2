const EventEmitter = require('events');

// In-memory room store. For production replace with DB or shared cache.
const rooms = new Map();

function createRoom(id, opts = {}) {
  if (rooms.has(id)) return rooms.get(id);
  const room = {
    id,
    players: new Map(),
    state: {
      phase: 'waiting',
      metadata: {},
      ...opts.state,
    },
    events: new EventEmitter(),
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) {
  return rooms.get(id);
}

function listRooms() {
  return Array.from(rooms.values()).map(r => ({ id: r.id, players: r.players.size, state: r.state }));
}

function addPlayer(roomId, player) {
  const room = getRoom(roomId) || createRoom(roomId);
  room.players.set(player.id, player);
  room.events.emit('player:joined', player);
  return room;
}

function removePlayer(roomId, playerId) {
  const room = getRoom(roomId);
  if (!room) return;
  const player = room.players.get(playerId);
  room.players.delete(playerId);
  room.events.emit('player:left', player);
  // optional: clean up empty rooms
  if (room.players.size === 0) rooms.delete(roomId);
}

module.exports = {
  createRoom,
  getRoom,
  listRooms,
  addPlayer,
  removePlayer,
};
