"use strict";
// Minimal rooms manager for migration stage
// Export a simple in-memory store that mirrors current server.rooms usage.
Object.defineProperty(exports, "__esModule", { value: true });
exports.rooms = void 0;
exports.createRoom = createRoom;
exports.getRoom = getRoom;
exports.hasRoom = hasRoom;
exports.deleteRoom = deleteRoom;
exports.listRooms = listRooms;
const rooms = new Map();
exports.rooms = rooms;
function createRoom(roomId, opts) {
    const room = Object.assign({
        id: roomId,
        name: (opts && opts.name) || 'Комната',
        maxSeats: (opts && opts.maxSeats) || 6,
        hasChat: (opts && opts.hasChat !== undefined) ? opts.hasChat : true,
        enabledRoles: (opts && opts.enabledRoles) || ['mafia', 'cop', 'doctor'],
        votes: {},
        nightActionActors: {},
        lastWordPlayerId: null,
        users: {},
        seats: [],
        gameStatus: 'waiting',
        currentTurnIndex: 0,
        turnOrder: [],
        timer: null,
        nightActions: { mafiaTarget: null, doctorTarget: null, copTarget: null }
    }, opts || {});
    // init seats
    for (let i = 0; i < room.maxSeats; i++)
        room.seats[i] = null;
    rooms.set(roomId, room);
    return room;
}
function getRoom(roomId) {
    return rooms.get(roomId);
}
function hasRoom(roomId) {
    return rooms.has(roomId);
}
function deleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (room && room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
    rooms.delete(roomId);
}
function listRooms() {
    return Array.from(rooms.values()).map((r) => ({ id: r.id, players: Object.keys(r.users || {}).length, state: r.gameStatus }));
}
