const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine } = require('../server/engine');
const { evaluateVictory } = require('../server/roles');

test('timers drive night, speeches, discussion, vote and exactly one end', async (t) => {
  const phases = [];
  let engine, room, resolve;
  const complete = new Promise((r) => {
    resolve = r;
  });
  engine = new GameEngine({
    victory: evaluateVictory,
    personal() {},
    durations: {
      night: 0.01,
      night_result: 0.01,
      day_speeches: 0.01,
      day_discussion: 0.01,
      day_voting: 0.05,
      vote_result: 0.01,
      last_words: 0.01,
    },
    broadcast(id, event, data) {
      if (event === 'update-room') phases.push(data.gameStatus);
      if (event === 'voting-started')
        queueMicrotask(() => {
          for (const voter of engine.alive(room))
            engine.vote(room, voter.id, voter.role === 'mafia' ? null : 'mafia', room.revision);
        });
      if (event === 'game-ended') resolve(data);
    },
  });
  t.after(() => engine.close());
  room = engine.create({ maxSeats: 3 });
  ['mafia', 'doctor', 'cop'].forEach((role, i) => {
    engine.join(room, role, { username: role });
    engine.takeSeat(room, role, i);
    Object.assign(room.users[role], { role, isAlive: true });
  });
  room.roster = Object.values(room.users).map((p) => ({ ...p }));
  engine.night(room);
  const result = await complete;
  assert.equal(result.winner, 'peaceful');
  assert.deepEqual(
    [...new Set(phases)].filter((p) => p !== 'waiting'),
    ['night', 'night_result', 'day_speeches', 'day_discussion', 'day_voting', 'vote_result']
  );
  assert.equal(room.gameStatus, 'waiting');
  assert.equal(room.timer, null);
});

test('deleting an empty room cancels delayed transitions', async (t) => {
  const engine = new GameEngine({
    victory: evaluateVictory,
    personal() {},
    broadcast() {},
    durations: { night: 0.01, night_result: 0.01 },
  });
  t.after(() => engine.close());
  const room = engine.create({});
  engine.join(room, 'a', { username: 'a' });
  engine.night(room);
  engine.remove(room, 'a');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(engine.rooms.size, 0);
});
