const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../server/index');

test('production entry serves the game, new cards, scripts and health without exposing server files', async (t) => {
  const app = createApplication({ config: { LIVEKIT_URL: '', LK_API_KEY: '', LK_API_SECRET: '' } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const page = await (await fetch(base)).text();
  for (const name of ['rules', 'sounds', 'ui', 'livekit']) {
    assert.ok(page.includes(`/js/${name}.js`));
    const response = await fetch(`${base}/js/${name}.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const name of ['jurnalist_cart.png', 'serjant_cart.png']) {
    const response = await fetch(`${base}/carts/${name}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(data.readUInt32BE(16) >= 512);
    assert.ok(data.readUInt32BE(20) >= 512);
  }
  const sdk = await fetch(`${base}/vendor/livekit-client.js`);
  assert.equal(sdk.status, 200);
  assert.ok((await sdk.text()).includes('LivekitClient'));
  for (const name of ['/server/config.js', '/.env', '/.git/config'])
    assert.equal((await fetch(base + name)).status, 404);
});
