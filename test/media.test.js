const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMedia } = require('../server/media');
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
  const u = { id: 'player', connected: true, mediaConnected: true },
    room = {
      id: 'room',
      mediaRoom: 'unique-media-room',
      gameStatus: 'waiting',
      users: { player: u },
    };
  const engine = { rooms: new Map([['room', room]]), canSpeak: (r) => r.gameStatus === 'waiting' };
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
  assert.equal(updates.at(-1).canPublish, false);
  assert.equal(updates.at(-1).canSubscribe, false);
  room.gameStatus = 'day_voting';
  await media.sync(room);
  assert.equal(updates.at(-1).canPublish, false);
  assert.equal(updates.at(-1).canSubscribe, true);
  failed = true;
  room.gameStatus = 'waiting';
  await media.sync(room);
  assert.equal(removed, 1);
  assert.deepEqual(failures, ['player']);
  assert.equal(u.mediaConnected, false);
});
