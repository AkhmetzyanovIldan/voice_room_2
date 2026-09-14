const { test } = require('node:test');
const assert = require('node:assert/strict');
const { civilianCanWin } = require('../server/endgame');

test('all supported role subsets at parity finish analysis, including spent and first-night states', () => {
  const roles = ['mafia', 'don', 'lawyer', 'doctor', 'sergeant', 'mistress', 'cop', 'journalist'];
  let checked = 0;
  for (let mask = 1; mask < 1 << roles.length; mask++) {
    const selected = roles.filter((_, i) => mask & (1 << i));
    if (!selected.some((r) => r === 'mafia' || r === 'don')) continue;
    const mafia = selected.filter((r) => ['mafia', 'don', 'lawyer'].includes(r)).length;
    if (selected.length > mafia * 2) continue;
    while (selected.length < mafia * 2) selected.push('civilian');
    for (const phase of ['day', 'night'])
      for (const spent of [false, true]) {
        const room = {
          round: spent ? 1 : 2,
          users: Object.fromEntries(
            selected.map((role, i) => [i, { role, seat: i, isAlive: true, shotUsed: spent }])
          ),
        };
        const result = civilianCanWin(room, phase);
        assert.equal(typeof result, 'boolean', `${selected.join(',')}: ${phase}, spent=${spent}`);
        if (!selected.includes('sergeant') && !selected.includes('mistress'))
          assert.equal(result, false);
        checked++;
      }
  }
  assert.ok(checked >= 200);
});
