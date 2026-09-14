// Qualitative reachability for simultaneous nights and coordinated daytime votes.
// A civilian chance must exist against EVERY mafia choice. The corresponding
// night defence may differ: randomising a hidden choice can retain a nonzero chance.
// Cycles without a path to eliminating all shooters do not count as a rescue.
const cache = new Map();
const clan = (role) => ['mafia', 'don', 'lawyer'].includes(role);
const bits = (mask, n) => Array.from({ length: n }, (_, i) => 1 << i).filter((b) => mask & b);

function civilianCanWin(room, phase) {
  const players = Object.values(room.users)
    .filter((u) => u.seat !== null && u.isAlive)
    .sort((a, b) => a.role.localeCompare(b.role) || a.seat - b.seat);
  const n = players.length,
    all = (1 << n) - 1;
  let mafia = 0,
    shooters = 0;
  players.forEach((u, i) => {
    if (clan(u.role)) mafia |= 1 << i;
    if (u.role === 'mafia' || u.role === 'don') shooters |= 1 << i;
  });
  const peaceful = all ^ mafia;
  const roleBit = (role) => {
    const i = players.findIndex((u) => u.role === role);
    return i < 0 ? 0 : 1 << i;
  };
  const doctor = roleBit('doctor'),
    sergeant = roleBit('sergeant'),
    mistress = roleBit('mistress');
  const round = room.round || 1;
  const isNight = phase === 'night';
  const blockMask = (field, value) =>
    players.reduce((m, u, i) => m | (u[field] === value ? 1 << i : 0), 0);
  // [living mask, spent shot, self-heal cooldown, ability block, vote block, first night, night]
  const initial = [
    all,
    +!!players.find((u) => u.role === 'sergeant')?.shotUsed,
    +!!room.doctorSelfHealUsedLastNight,
    blockMask('nightBlockedRound', round + (isNight ? 0 : 1)),
    isNight ? 0 : blockMask('voteBlockedRound', round),
    +(isNight && round === 1),
    +isNight,
  ];
  const cacheKey = `${players.map((u) => u.role).join(',')}:${initial.join(',')}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const nodes = [{ won: false }, { won: true }],
    ids = new Map();
  function node(state) {
    const [alive] = state;
    if (!(alive & shooters)) return 1;
    if (!(alive & peaceful)) return 0;
    // Normalise memory that cannot affect any future action.
    if (!(alive & sergeant)) state[1] = 1;
    if (!(alive & doctor)) state[2] = 0;
    state[3] &= alive;
    state[4] &= alive;
    const key = state.join(',');
    if (!ids.has(key)) {
      if (nodes.length >= 50000) throw new RangeError('Endgame state budget');
      ids.set(key, nodes.length);
      nodes.push({ state, won: false, groups: [] });
    }
    return ids.get(key);
  }
  let root;
  try {
    root = node(initial);
    for (let i = 2; i < nodes.length; i++) {
      const [alive, spent, cooldown, blocked, voteBlocked, first, night] = nodes[i].state;
      const enemies = bits(alive & mafia, n),
        civilians = bits(alive & peaceful, n);
      if (!night) {
        const pVotes = civilians.filter((b) => !(voteBlocked & b)).length;
        const mVotes = enemies.filter((b) => !(voteBlocked & b)).length;
        const next = (target) => node([alive & ~target, spent, cooldown, blocked, 0, 0, 1]);
        if (pVotes > mVotes) nodes[i].groups = [[...enemies, 0].map(next)];
        else if (mVotes > pVotes) nodes[i].groups = [...civilians, 0].map((b) => [next(b)]);
        else nodes[i].groups = [[next(0)]];
        continue;
      }
      const available = alive & ~blocked;
      const attacks = available & shooters ? [0, ...civilians] : [0];
      const heals =
        available & doctor ? [0, ...bits(alive, n).filter((b) => b !== doctor || !cooldown)] : [0];
      const shots =
        available & sergeant && !spent && !first ? [0, ...bits(alive & ~sergeant, n)] : [0];
      const charms = available & mistress ? [0, ...bits(alive & ~mistress, n)] : [0];
      // One group per mafia choice; any simultaneous civilian response in that
      // group is enough. All groups must eventually reach the winning set.
      for (const attack of attacks) {
        const outcomes = new Set();
        for (const heal of heals)
          for (const shot of shots)
            for (const charm of charms) {
              const survivors = alive & ~((attack | shot) & ~heal);
              outcomes.add(
                node([
                  survivors,
                  +(spent || !!shot),
                  +(!!doctor && heal === doctor),
                  charm,
                  charm,
                  0,
                  0,
                ])
              );
            }
        nodes[i].groups.push([...outcomes]);
      }
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    // Never award mafia a victory on an incomplete analysis.
    return null;
  }
  const parents = Array.from({ length: nodes.length }, () => []);
  for (let i = 2; i < nodes.length; i++) {
    nodes[i].remaining = nodes[i].groups.length;
    for (const children of nodes[i].groups) {
      const group = { parent: i, reached: false };
      for (const child of new Set(children)) parents[child].push(group);
    }
  }
  const queue = [1];
  for (let head = 0; head < queue.length; head++) {
    for (const group of parents[queue[head]]) {
      if (group.reached) continue;
      group.reached = true;
      const parent = nodes[group.parent];
      if (--parent.remaining === 0 && !parent.won) {
        parent.won = true;
        queue.push(group.parent);
      }
    }
  }
  const result = nodes[root].won;
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, result);
  return result;
}

module.exports = { civilianCanWin };
