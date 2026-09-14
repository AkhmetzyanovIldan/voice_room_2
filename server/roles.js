const ROLE_DEFINITIONS = [
  { id: 'mafia', name: 'Мафия', clan: 'mafia', enabledByDefault: true },
  { id: 'don', name: 'Дон', clan: 'mafia', enabledByDefault: false },
  { id: 'lawyer', name: 'Адвокат', clan: 'mafia', enabledByDefault: false },
  { id: 'cop', name: 'Комиссар', clan: 'peaceful', enabledByDefault: true },
  { id: 'doctor', name: 'Врач', clan: 'peaceful', enabledByDefault: true },
  { id: 'sergeant', name: 'Сержант', clan: 'peaceful', enabledByDefault: false },
  { id: 'journalist', name: 'Журналист', clan: 'peaceful', enabledByDefault: false },
  { id: 'mistress', name: 'Любовница', clan: 'peaceful', enabledByDefault: false },
];

const ROLE_IDS = new Set(ROLE_DEFINITIONS.map((role) => role.id));
const DEFAULT_ENABLED_ROLE_IDS = ROLE_DEFINITIONS.filter((role) => role.enabledByDefault).map(
  (role) => role.id
);

function evaluateVictory(room, phase) {
  const living = Object.values(room.users).filter((u) => u.seat !== null && u.isAlive);
  if (!living.some((u) => u.role === 'mafia' || u.role === 'don')) return 'peaceful';
  const mafia = living.filter((u) => getClan(u.role) === 'mafia').length;
  const peaceful = living.length - mafia;
  if (!peaceful) return 'mafia';
  if (peaceful > mafia) return null;
  // During a submitted night, wait for its real outcome rather than replacing
  // irrevocable choices with hypothetical ones.
  if (!phase && room.gameStatus === 'night' && Object.keys(room.nightActionActors || {}).length)
    return null;
  if (!phase) {
    phase =
      room.victoryPhase ||
      (['day_speeches', 'day_discussion', 'day_voting', 'night_result'].includes(room.gameStatus)
        ? 'day'
        : 'night');
    if (phase === 'night' && ['vote_result', 'last_words'].includes(room.gameStatus))
      room = { ...room, round: room.round + 1 };
  }
  return require('./endgame').civilianCanWin(room, phase) === false ? 'mafia' : null;
}

function getClan(role) {
  return role === 'mafia' || role === 'don' || role === 'lawyer' ? 'mafia' : 'peaceful';
}

function normalizeEnabledRoles(value) {
  if (!Array.isArray(value)) return [...DEFAULT_ENABLED_ROLE_IDS];
  return [...new Set(value.filter((roleId) => ROLE_IDS.has(roleId)))];
}

module.exports = {
  ROLE_DEFINITIONS,
  DEFAULT_ENABLED_ROLE_IDS,
  normalizeEnabledRoles,
  evaluateVictory,
  getClan,
};
