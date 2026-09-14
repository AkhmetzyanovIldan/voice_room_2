const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMedia } = require('../server/media');
const { GameEngine } = require('../server/engine');

test('client leaving old channel before phase sync is not a voice failure', async () => {
  const failures = [];
  const u = { id: 'p', mediaConnected: true, mediaChannel: 'room' };
  const room = { id: 'r', mediaRoom: 'test', users: { p: u } };
  const engine = { rooms: new Map([['r', room]]), mediaChannel: () => 'mafia' };
  const sdk = {
    RoomServiceClient: class {
      async removeParticipant() {
        throw Object.assign(Error('Already disconnected'), { code: 'not_found' });
      }
    },
  };
  const media = createMedia(
    { LK_API_KEY: 'test', LK_API_SECRET: 'test', LIVEKIT_URL: 'wss://example.invalid' },
    engine,
    (id) => failures.push(id),
    sdk
  );
  await media.sync(room);
  assert.deepEqual(failures, []);
  assert.equal(u.mediaConnected, false);
  assert.equal(u.mediaPermission, null);
});
test('LiveKit issues muted room-scoped tokens and revokes phase permissions', async () => {
  const updates = [],
    failures = [];
  let failed = false,
    removed = 0,
    grant;
  const sdk = {
    AccessToken: class {
      addGrant(g) {
        grant = g;
      }
      async toJwt() {
        return 'test-only';
      }
    },
    RoomServiceClient: class {
      async updateParticipant(room, id, { permission }) {
        if (failed) throw Error('offline');
        updates.push(permission);
      }
      async removeParticipant() {
        removed++;
      }
    },
  };
  const u = { id: 'player', connected: true, mediaConnected: true, mediaChannel: 'room' },
    room = {
      id: 'room',
      mediaRoom: 'unique-media-room',
      gameStatus: 'waiting',
      users: { player: u },
    };
  const engine = {
    rooms: new Map([['room', room]]),
    canSpeak: (r) => r.gameStatus === 'waiting',
    mediaChannel: (r) => (r.gameStatus === 'night' ? null : 'room'),
  };
  const media = createMedia(
    { LK_API_KEY: 'test', LK_API_SECRET: 'test', LIVEKIT_URL: 'wss://example.invalid' },
    engine,
    (id) => failures.push(id),
    sdk
  );
  await media.token(room, u);
  assert.equal(grant.room, room.mediaRoom);
  assert.equal(grant.canPublish, false);
  assert.equal(grant.canSubscribe, false);
  assert.equal(grant.canPublishData, false);
  await media.sync(room);
  assert.equal(updates[0].canPublish, true);
  room.gameStatus = 'night';
  await media.sync(room);
  assert.equal(removed, 1);
  assert.equal(u.mediaConnected, false);
  assert.equal((await media.token(room, u)).token, null);
  room.gameStatus = 'day_voting';
  u.mediaConnected = true;
  await media.sync(room);
  assert.equal(updates.at(-1).canPublish, false);
  assert.equal(updates.at(-1).canSubscribe, true);
  failed = true;
  room.gameStatus = 'waiting';
  await media.sync(room);
  assert.equal(removed, 2);
  assert.deepEqual(failures, ['player']);
  assert.equal(u.mediaConnected, false);
});

test('private night room admits only mafia; dead mafia receive audio but cannot publish', async (t) => {
  const grants = [],
    updates = [],
    removals = [];
  const sdk = {
    AccessToken: class {
      addGrant(grant) {
        grants.push(grant);
      }
      async toJwt() {
        return 'test';
      }
    },
    RoomServiceClient: class {
      async updateParticipant(room, id, { permission }) {
        updates.push({ room, id, permission });
      }
      async removeParticipant(room, id) {
        removals.push({ room, id });
      }
    },
  };
  const engine = new GameEngine({ broadcast() {}, personal() {}, victory() {} });
  t.after(() => engine.close());
  const room = engine.create({});
  for (const [i, role] of ['mafia', 'don', 'lawyer', 'doctor', null].entries()) {
    const u = engine.join(room, String(i), { username: String(i) });
    Object.assign(u, { role, seat: role ? i : null, isAlive: role !== 'don' });
  }
  const media = createMedia(
    { LK_API_KEY: 'test', LK_API_SECRET: 'test', LIVEKIT_URL: 'wss://example.invalid' },
    engine,
    () => assert.fail('unexpected API error'),
    sdk
  );
  room.gameStatus = 'night';
  for (const id of ['0', '1', '2']) {
    const u = room.users[id];
    const token = await media.token(room, u);
    assert.equal(token.channel, 'mafia');
    assert.equal(grants.at(-1).room, `${room.mediaRoom}-clan`);
    assert.equal(grants.at(-1).canSubscribe, false);
    Object.assign(u, { mediaConnected: true, mediaChannel: 'mafia' });
  }
  for (const id of ['3', '4']) assert.equal((await media.token(room, room.users[id])).token, null);
  await media.sync(room);
  assert.equal(updates.find((u) => u.id === '1').permission.canPublish, false);
  assert.equal(updates.find((u) => u.id === '1').permission.canSubscribe, true);
  assert.equal(updates.find((u) => u.id === '0').permission.canPublish, true);
  assert.equal(updates.find((u) => u.id === '2').permission.canPublish, true);
  room.gameStatus = 'day_discussion';
  const token = await media.token(room, room.users['0']);
  assert.equal(token.channel, 'room');
  assert.equal(grants.at(-1).room, room.mediaRoom);
  assert.equal(removals.length, 3);
  assert.ok(removals.every((r) => r.room === `${room.mediaRoom}-clan`));
});
