const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const rooms = [],
    sent = [],
    attached = [];
  const host = {
    replaceChildren() {
      attached.length = 0;
    },
    append(el) {
      attached.push(el);
    },
    querySelectorAll() {
      return attached;
    },
  };
  class Room {
    constructor() {
      this.handlers = {};
      this.state = 'disconnected';
      this.connection = deferred();
      this.disconnectGate = null;
      this.disconnectCalls = 0;
      rooms.push(this);
    }
    on(event, callback) {
      this.handlers[event] = callback;
    }
    async connect() {
      this.state = 'connecting';
      await this.connection.promise;
      this.state = 'connected';
    }
    async disconnect() {
      this.disconnectCalls++;
      if (this.disconnectGate) await this.disconnectGate.promise;
      this.state = 'disconnected';
      this.handlers.disconnected?.();
    }
    async startAudio() {
      this.canPlaybackAudio = true;
    }
  }
  const window = {
    LivekitClient: {
      Room,
      RoomEvent: {
        TrackSubscribed: 'track',
        TrackUnsubscribed: 'untrack',
        Disconnected: 'disconnected',
        Reconnected: 'reconnected',
        AudioPlaybackStatusChanged: 'playback',
      },
    },
    appSocket: { emit: (...args) => sent.push(args) },
    appEvents: { emit() {} },
  };
  const document = { createElement: () => host, body: { append() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/livekit.js'), 'utf8'), {
    window,
    document,
  });
  return { audio: window.gameAudio, rooms, sent, attached };
}
const token = (channel) => ({ url: 'wss://test.invalid', token: 'test-only', channel });

test('late night connection never replaces a newer day connection', async () => {
  const { audio, rooms, sent } = fixture();
  const first = audio.connect(token('room'));
  rooms[0].connection.resolve();
  await first;
  rooms[0].disconnectGate = deferred();
  const stale = audio.connect(token('mafia'));
  const cancel = audio.disconnect();
  const latest = audio.connect(token('room'));
  const newest = rooms.at(-1);
  newest.connection.resolve();
  await latest;
  rooms[0].disconnectGate.resolve();
  await cancel;
  await Promise.resolve();
  for (const room of rooms) room.connection.resolve();
  await stale;
  assert.equal(audio.connected(), true);
  assert.equal(newest.disconnectCalls, 0);
  assert.equal(sent.filter((e) => e[1]?.channel === 'mafia').length, 0);
});

test('failed connection is cleaned up and can be retried', async () => {
  const { audio, rooms } = fixture();
  const attempt = audio.connect(token('room'));
  rooms[0].connection.reject(Error('network'));
  await assert.rejects(attempt, /network/);
  assert.equal(audio.connected(), false);
  assert.equal(rooms[0].disconnectCalls, 1);
  const retry = audio.connect(token('room'));
  rooms.at(-1).connection.resolve();
  await retry;
  assert.equal(audio.connected(), true);
});

test('muted audio stays muted after reconnect and late tracks are ignored', async () => {
  const { audio, rooms, attached } = fixture();
  await audio.mute(true);
  const attempt = audio.connect(token('mafia'));
  rooms[0].connection.resolve();
  await attempt;
  const element = {};
  rooms[0].handlers.track({ kind: 'audio', attach: () => element });
  assert.equal(element.muted, true);
  await audio.disconnect();
  rooms[0].handlers.track({ kind: 'audio', attach: () => ({}) });
  assert.equal(attached.length, 0);
});
