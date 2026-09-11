const { createHmac, timingSafeEqual } = require('node:crypto');
function telegramProfile(initData, token, now = Date.now()) {
  if (!token || typeof initData !== 'string' || initData.length > 16000)
    throw new Error('Не удалось проверить вход через Telegram');
  const params = new URLSearchParams(initData),
    hash = params.get('hash'),
    date = Number(params.get('auth_date'));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !date || Math.abs(now / 1000 - date) > 86400)
    throw new Error('Откройте игру заново через Telegram');
  params.delete('hash');
  const data = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  if (
    !timingSafeEqual(createHmac('sha256', secret).update(data).digest(), Buffer.from(hash, 'hex'))
  )
    throw new Error('Недействительные данные Telegram');
  const u = JSON.parse(params.get('user') || '{}');
  if (!Number.isSafeInteger(u.id)) throw new Error('Неизвестный пользователь Telegram');
  return {
    telegramId: String(u.id),
    username: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username,
    photoUrl: u.photo_url,
  };
}
function profile(p = {}) {
  let photoUrl = '';
  try {
    const url = new URL(p.photoUrl);
    if (url.protocol === 'https:') photoUrl = url.href.slice(0, 2048);
  } catch {}
  return {
    username:
      String(p.username || 'Игрок')
        .trim()
        .slice(0, 30) || 'Игрок',
    photoUrl,
  };
}
module.exports = { telegramProfile, profile };
