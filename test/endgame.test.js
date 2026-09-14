const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateVictory } = require('../server/roles');
const { civilianCanWin } = require('../server/endgame');
function room(roles, overrides = {}) {
  return {
    round: 2,
    gameStatus: 'night',
    users: Object.fromEntries(
      roles.map((role, i) => [i, { id: String(i), role, seat: i, isAlive: true, shotUsed: false }])
    ),
    ...overrides,
  };
}
test('lawyer alone cannot prevent civilian victory, even with no civilians left', () => {
  assert.equal(evaluateVictory(room(['lawyer', 'civilian'])), 'peaceful');
  assert.equal(evaluateVictory(room(['lawyer'])), 'peaceful');
});
test('doctor and unspent sergeant can rescue parity against either mafia target', () => {
  const r = room(['mafia', 'don', 'doctor', 'sergeant']);
  assert.equal(evaluateVictory(r), null);
  r.users[3].shotUsed = true;
  assert.equal(evaluateVictory(r), 'mafia');
});
test('sergeant can kill last shooter simultaneously with own death', () => {
  const r = room(['mafia', 'sergeant']);
  assert.equal(evaluateVictory(r), null);
  r.round = 1;
  assert.equal(evaluateVictory(r), 'mafia');
  r.round = 2;
  r.users[1].nightBlockedRound = 2;
  assert.equal(evaluateVictory(r), 'mafia');
});
test('a mistress alone needs an existing charm; a fresh charm does not stop current shot', () => {
  const r = room(['don', 'mistress']);
  assert.equal(evaluateVictory(r), 'mafia');
  r.users[0].nightBlockedRound = 2;
  assert.equal(evaluateVictory(r), null);
  r.gameStatus = 'day_voting';
  r.users[0].nightBlockedRound = 3;
  r.users[0].voteBlockedRound = 2;
  assert.equal(evaluateVictory(r), null);
});
test('doctor and mistress can rescue parity; doctor without either helper cannot', () => {
  assert.equal(evaluateVictory(room(['mafia', 'don', 'doctor', 'mistress'])), null);
  assert.equal(evaluateVictory(room(['mafia', 'don', 'doctor', 'cop'])), 'mafia');
});
test('charm survives mistress death and can give civilians the deciding daytime vote', () => {
  const r = room(['mafia', 'civilian'], { gameStatus: 'day_voting' });
  r.users[0].voteBlockedRound = 2;
  r.users[0].nightBlockedRound = 3;
  assert.equal(evaluateVictory(r), null);
  r.users[0].voteBlockedRound = 1;
  r.users[0].nightBlockedRound = 2;
  assert.equal(evaluateVictory(r), 'mafia');
});
test('a second shooter defeats a lone mistress even when one shooter is blocked', () => {
  const r = room(['mafia', 'don', 'mistress']);
  r.users[0].nightBlockedRound = 2;
  assert.equal(evaluateVictory(r), 'mafia');
});
test('ability to win differs before night and after night at equal numbers', () => {
  const r = room(['mafia', 'sergeant']);
  assert.equal(civilianCanWin(r, 'night'), true);
  assert.equal(civilianCanWin(r, 'day'), true);
  r.users[1].shotUsed = true;
  assert.equal(civilianCanWin(r, 'day'), false);
});
