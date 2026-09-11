const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { telegramProfile, profile } = require('../server/auth');
test('Telegram signature, expiry and tampering are checked', () => {
  const now = Date.now(),
    token = 'test:token';
  const p = new URLSearchParams({
    auth_date: String(Math.floor(now / 1000)),
    user: JSON.stringify({ id: 123, first_name: 'Test' }),
  });
  const data = [...p]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  assert.equal(telegramProfile(p.toString(), token, now).telegramId, '123');
  assert.throws(() => telegramProfile(p.toString(), token, now + 2 * 86400000));
  p.set('user', JSON.stringify({ id: 456, first_name: 'Other' }));
  assert.throws(() => telegramProfile(p.toString(), token, now));
});
test('profile only accepts HTTPS avatars and limits names', () => {
  assert.equal(
    profile({ username: 'x'.repeat(100), photoUrl: 'javascript:alert(1)' }).username.length,
    30
  );
  assert.equal(profile({ photoUrl: 'javascript:alert(1)' }).photoUrl, '');
  assert.equal(
    profile({ photoUrl: 'https://example.com/a.png' }).photoUrl,
    'https://example.com/a.png'
  );
});
