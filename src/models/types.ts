export type Role = 'mafia' | 'cop' | 'doctor' | 'civilian' | string;
export type GameStatus = 'waiting' | 'night' | 'day_speeches' | 'day_discussion' | 'day_voting';

export interface NightActions {
  mafiaTarget: string | null;
  doctorTarget: string | null;
  copTarget: string | null;
  [key: string]: string | null;
}

export interface Player {
  id: string;
  username: string;
  photoUrl?: string;
  seat: number | null;
  mic: boolean;
  isReady: boolean;
  isAlive: boolean;
  role: Role | null;
}

export interface Room {
  id: string;
  name: string;
  maxSeats: number;
  hasChat: boolean;
  enabledRoles: string[];
  votes: Record<string, string>;
  nightActionActors: Record<string, boolean>;
  users: Record<string, Player>;
  // seats as array indexed by seat number (0..maxSeats-1)
  seats: (string | null)[];
  gameStatus: GameStatus;
  currentTurnIndex: number;
  turnOrder: Player[];
  timer: any;
  nightActions: NightActions;
}
