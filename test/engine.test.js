const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine } = require('../server/engine');
const { evaluateVictory } = require('../server/roles');

function fixture(t, roles = ['mafia', 'doctor', 'cop', 'civilian', 'civilian', 'civilian']) {
  const events = [];
  const engine = new GameEngine({
    broadcast: (id, event, data) => events.push({ id, event, data }),
    personal: (id, event, data) => events.push({ id, event, data }),
    victory: evaluateVictory,
  });
  const room = engine.create({ maxSeats: Math.max(3, roles.length) });
  roles.forEach((role, i) => {
    engine.join(room, `p${i}`, { username: `P${i}` });
    engine.takeSeat(room, `p${i}`, i);
    Object.assign(room.users[`p${i}`], { role, isAlive: true });
  });
  room.roster = Object.values(room.users).map((u) => ({ ...u }));
  engine.night(room);
  t.after(() => engine.close());
  const act = (id, target, type, targets) =>
    engine.act(room, id, target, type, room.revision, targets);
  return { engine, room, events, act };
}
test('a passive extra weight no longer prevents mafia victory at parity', () => {
  for (const role of ['doctor', 'cop', 'mistress']) {
    const room = {
      users: { a: { seat: 0, isAlive: true, role: 'mafia' }, b: { seat: 1, isAlive: true, role } },
    };
    assert.equal(evaluateVictory(room), 'mafia');
    room.users.b.voteBlockedRound = 1;
    assert.equal(evaluateVictory(room), 'mafia');
    room.users.b.role = 'civilian';
    assert.equal(evaluateVictory(room), 'mafia');
    room.users.a.isAlive = false;
    assert.equal(evaluateVictory(room), 'peaceful');
  }
});
test('spectators and dead players never contribute to victory', () => {
  const room = {
    users: {
      a: { seat: 0, isAlive: false, role: 'mafia' },
      b: { seat: null, isAlive: true, role: 'don' },
      c: { seat: 1, isAlive: true, role: 'civilian' },
    },
  };
  assert.equal(evaluateVictory(room), 'peaceful');
});
test('selected roles are dealt once and citizens fill remaining seats', (t) => {
  const { engine, room } = fixture(t);
  room.gameStatus = 'waiting';
  room.enabledRoles = ['mafia', 'lawyer', 'mistress'];
  engine.start(room);
  assert.deepEqual(
    Object.values(room.users)
      .map((u) => u.role)
      .sort(),
    ['mafia', 'lawyer', 'mistress', 'civilian', 'civilian', 'civilian'].sort()
  );
});
test('night actions reset; already dead victim is not killed twice', (t) => {
  const { engine, room, act, events } = fixture(t);
  act('p0', 'p3', 'mafia_kill');
  engine.resolveNight(room);
  assert.equal(room.users.p3.isAlive, false);
  engine.night(room);
  assert.deepEqual(room.nightActionActors, {});
  engine.resolveNight(room);
  assert.equal(events.filter((e) => e.event === 'night-result').at(-1).data.killedPlayerName, null);
});
test('night closes immediately; duplicate and stale requests rejected', (t) => {
  const { engine, room, act } = fixture(t);
  act('p0', 'p3', 'mafia_kill');
  assert.throws(() => act('p0', 'p4', 'mafia_kill'));
  const old = room.revision;
  engine.resolveNight(room);
  assert.throws(() => act('p1', 'p1', 'doctor_heal'));
  engine.night(room);
  assert.throws(() => engine.act(room, 'p0', 'p4', 'mafia_kill', old));
});
test('reject night actions against dead players, spectators and wrong abilities', (t) => {
  const { engine, room, act } = fixture(t);
  room.users.p3.isAlive = false;
  engine.join(room, 'spectator', { username: 'S' });
  assert.throws(() => act('p0', 'p3', 'mafia_kill'));
  assert.throws(() => act('p0', 'spectator', 'mafia_kill'));
  assert.throws(() => act('p4', 'p5', 'mafia_kill'));
  assert.throws(() => act('p0', 'p0', 'mafia_kill'));
});
test('doctor self heal is limited to alternating nights and resets between games', (t) => {
  const { engine, room, act } = fixture(t);
  act('p1', 'p1', 'doctor_heal');
  engine.resolveNight(room);
  engine.night(room);
  assert.throws(() => act('p1', 'p1', 'doctor_heal'));
  engine.resolveNight(room);
  engine.night(room);
  act('p1', 'p1', 'doctor_heal');
  engine.end(room, 'peaceful');
  engine.start(room);
  assert.equal(room.doctorSelfHealUsedLastNight, false);
});
test('healing prevents both mafia and sergeant attacks on the same target', (t) => {
  const { engine, room, act } = fixture(t, ['mafia', 'doctor', 'sergeant', 'civilian', 'civilian']);
  engine.night(room);
  act('p0', 'p3', 'mafia_kill');
  act('p2', 'p3', 'sergeant_kill');
  act('p1', 'p3', 'doctor_heal');
  engine.resolveNight(room);
  assert.equal(room.users.p3.isAlive, true);
});
test('sergeant cannot shoot on first night and can shoot only once per game', (t) => {
  const { engine, room, act } = fixture(t, ['mafia', 'doctor', 'sergeant', 'civilian', 'civilian']);
  assert.throws(() => act('p2', 'p3', 'sergeant_kill'));
  engine.night(room);
  act('p2', 'p3', 'sergeant_kill');
  engine.resolveNight(room);
  assert.equal(room.users.p3.isAlive, false);
  engine.night(room);
  assert.throws(() => act('p2', 'p4', 'sergeant_kill'));
});
test('don has independent check and shared clan shot; tied clan choices do not kill', (t) => {
  const { engine, room, act, events } = fixture(t, [
    'mafia',
    'don',
    'cop',
    'doctor',
    'civilian',
    'civilian',
  ]);
  act('p1', 'p2', 'don_check');
  act('p1', 'p4', 'mafia_kill');
  act('p0', 'p5', 'mafia_kill');
  engine.resolveNight(room);
  assert.equal(room.users.p4.isAlive, true);
  assert.equal(room.users.p5.isAlive, true);
  assert.equal(events.find((e) => e.event === 'investigation-result').data.isCop, true);
});
test('lawyer and don receive checks even when killed simultaneously', (t) => {
  const { engine, room, act, events } = fixture(t, [
    'don',
    'lawyer',
    'sergeant',
    'doctor',
    'civilian',
    'civilian',
  ]);
  engine.night(room);
  act('p1', 'p3', 'lawyer_check');
  act('p0', 'p3', 'don_check');
  act('p2', 'p1', 'sergeant_kill');
  engine.resolveNight(room);
  assert.equal(room.users.p1.isAlive, false);
  assert.equal(
    events.find((e) => e.id === 'p1' && e.event === 'investigation-result').data.role,
    'doctor'
  );
});
test('journalist publishes camp comparison only when surviving the night', (t) => {
  const { engine, room, act, events } = fixture(t, [
    'mafia',
    'journalist',
    'doctor',
    'civilian',
    'civilian',
  ]);
  act('p1', 'p0', 'journalist_check', ['p0', 'p2']);
  engine.resolveNight(room);
  assert.equal(
    events.filter((e) => e.event === 'night-result').at(-1).data.headlines[0].sameClan,
    false
  );
  engine.night(room);
  act('p1', 'p0', 'journalist_check', ['p0', 'p2']);
  act('p0', 'p1', 'mafia_kill');
  engine.resolveNight(room);
  assert.deepEqual(events.filter((e) => e.event === 'night-result').at(-1).data.headlines, []);
});
test('charm blocks upcoming vote and next night, not current night', (t) => {
  const { engine, room, act } = fixture(t, ['mafia', 'mistress', 'doctor', 'cop', 'civilian']);
  act('p1', 'p3', 'mistress_charm');
  act('p3', 'p0', 'cop_check');
  engine.resolveNight(room);
  assert.equal(room.checks.p3.length, 1);
  assert.equal(evaluateVictory(room), null);
  engine.voting(room);
  assert.throws(() => engine.vote(room, 'p3', 'p0', room.revision));
  engine.night(room);
  assert.throws(() => act('p3', 'p0', 'cop_check'));
  engine.night(room);
  act('p3', 'p0', 'cop_check');
});
test('one daily vote per player; votes have weight one; late votes cannot re-resolve', (t) => {
  const { engine, room, events } = fixture(t);
  engine.voting(room);
  engine.vote(room, 'p2', 'p3', room.revision);
  engine.vote(room, 'p4', 'p5', room.revision);
  assert.throws(() => engine.vote(room, 'p2', 'p5', room.revision));
  engine.resolveVote(room);
  assert.equal(events.filter((e) => e.event === 'day-vote-result').at(-1).data.tie, true);
  assert.throws(() => engine.vote(room, 'p0', 'p3', room.revision));
  engine.resolveVote(room);
  assert.equal(events.filter((e) => e.event === 'day-vote-result').length, 1);
});
test('skip counts as submitted and unanimous skips eliminate nobody', (t) => {
  const { engine, room, events } = fixture(t);
  engine.voting(room);
  for (const id of Object.keys(room.users)) engine.vote(room, id, null, room.revision);
  assert.equal(room.gameStatus, 'vote_result');
  assert.equal(events.filter((e) => e.event === 'day-vote-result').length, 1);
});
test('microphone permission follows phase, life, connection and speaker', (t) => {
  const { engine, room } = fixture(t);
  const u = room.users.p0;
  assert.equal(engine.canSpeak(room, u), true);
  engine.speeches(room);
  assert.equal(engine.canSpeak(room, u), true);
  assert.equal(engine.canSpeak(room, room.users.p1), false);
  engine.discussion(room);
  u.isAlive = false;
  assert.equal(engine.canSpeak(room, u), false);
  u.isAlive = true;
  engine.voting(room);
  assert.equal(engine.canSpeak(room, u), false);
  assert.equal(u.mic, false);
  engine.lastWord(room, u.id, () => {});
  u.isAlive = false;
  assert.equal(engine.canSpeak(room, u), true);
  u.connected = false;
  assert.equal(engine.canSpeak(room, u), false);
});
test('rejoin preserves role and seat; public snapshots contain no roles or private checks', (t) => {
  const { engine, room } = fixture(t);
  engine.join(room, 'p0', { username: 'OTHER' });
  assert.equal(room.users.p0.role, 'mafia');
  assert.equal(room.users.p0.seat, 0);
  assert.equal(engine.snapshot(room).users.p0.role, undefined);
  assert.equal(engine.privateState(room, 'p3').doctorSelfHealUsedLastNight, false);
});
test('new games clear one-time skills and checks; final roster reveals roles', (t) => {
  const { engine, room, events } = fixture(t);
  room.users.p0.shotUsed = true;
  engine.end(room, 'peaceful');
  assert.equal(events.find((e) => e.event === 'game-ended').data.players.length, 6);
  engine.start(room);
  assert.equal(room.users.p0.shotUsed, false);
  assert.deepEqual(room.checks, {});
});
test('invalid room configuration and seat input are rejected', (t) => {
  const { engine, room } = fixture(t);
  assert.throws(() => engine.create({ maxSeats: -1 }));
  assert.throws(() => engine.create({ enabledRoles: ['cop'] }));
  assert.throws(() => engine.create({ enabledRoles: ['unknown'] }));
  room.gameStatus = 'waiting';
  assert.throws(() => engine.takeSeat(room, 'p0', 100));
  assert.throws(() => engine.takeSeat(room, 'p0', '1'));
});

test('healing and charm notify only their target; night speaking does not reveal the clan', (t) => {
  const { engine, room, events, act } = fixture(t, [
    'mafia',
    'doctor',
    'mistress',
    'civilian',
    'civilian',
  ]);
  assert.equal(engine.durations.night, 20);
  room.users.p0.mic = true;
  const publicUser = engine.snapshot(room).users.p0;
  assert.equal(publicUser.mic, false);
  assert.equal(publicUser.canSpeak, false);
  assert.equal(engine.privateState(room, 'p0').canSpeak, true);
  assert.equal(engine.privateState(room, 'p3').canSpeak, false);
  act('p0', 'p3', 'mafia_kill');
  act('p1', 'p3', 'doctor_heal');
  act('p2', 'p0', 'mistress_charm');
  engine.resolveNight(room);
  assert.deepEqual(
    events.filter((e) => e.event === 'healed').map((e) => [e.id, e.data.saved]),
    [['p3', true]]
  );
  assert.deepEqual(
    events.filter((e) => e.event === 'charmed').map((e) => e.id),
    ['p0']
  );
});
