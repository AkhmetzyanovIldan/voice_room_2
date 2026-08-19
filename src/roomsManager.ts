// Minimal rooms manager for migration stage
// Export a simple in-memory store that mirrors current server.rooms usage.

import { Room, Player, NightActions } from './models/types';

const rooms: Map<string, Room> = new Map();

function createRoom(roomId: string, opts: Partial<Room>) {
  const room: Room = Object.assign({
    id: roomId,
    name: (opts && (opts as any).name) || 'Комната',
    maxSeats: (opts && (opts as any).maxSeats) || 6,
    hasChat: (opts && (opts as any).hasChat !== undefined) ? (opts as any).hasChat : true,
    users: {},
    seats: [],
    gameStatus: 'waiting',
    currentTurnIndex: 0,
    turnOrder: [],
    timer: null,
    nightActions: { mafiaTarget: null, doctorTarget: null, copTarget: null }
  }, opts || {}) as Room;

  // init seats
  for (let i = 0; i < room.maxSeats; i++) room.seats[i] = null;

  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

function hasRoom(roomId: string) {
  return rooms.has(roomId);
}

function deleteRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (room && room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
  rooms.delete(roomId);
}

function listRooms() {
  return Array.from(rooms.values()).map((r: any) => ({ id: r.id, players: Object.keys(r.users || {}).length, state: r.gameStatus }));
}

export { rooms, createRoom, getRoom, hasRoom, deleteRoom, listRooms };