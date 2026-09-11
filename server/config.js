module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  LK_API_KEY: process.env.LK_API_KEY || '',
  LK_API_SECRET: process.env.LK_API_SECRET || '',
  LIVEKIT_URL: process.env.LIVEKIT_URL || '',
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  REQUIRE_TELEGRAM: process.env.REQUIRE_TELEGRAM === 'true',
  RECONNECT_GRACE_MS: Number(process.env.RECONNECT_GRACE_MS) || 60000,
};
