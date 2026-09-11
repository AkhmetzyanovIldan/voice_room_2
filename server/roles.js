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

const PLAYER_WEIGHT = {
  cop: 2,
  doctor: 2,
  mistress: 2,
};

function getPlayerWeight(role) {
  return PLAYER_WEIGHT[role] || 1;
}

function evaluateVictory(room) {
  let mafia = 0,
    peaceful = 0;
  for (const u of Object.values(room.users).filter((u) => u.seat !== null && u.isAlive)) {
    if (getClan(u.role) === 'mafia') mafia += getPlayerWeight(u.role);
    else peaceful += getPlayerWeight(u.role);
  }
  if (mafia === 0) return 'peaceful';
  return mafia >= peaceful ? 'mafia' : null;
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
  getPlayerWeight,
  evaluateVictory,
  getClan,
};
