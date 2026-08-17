// Server configuration
module.exports = {
  PORT: process.env.PORT || 3000,
  SECRET_KEY: process.env.SECRET_KEY || 'change-me',
  LK_API_KEY: process.env.LK_API_KEY || 'API32YvgsLPxepo',
  LK_API_SECRET: process.env.LK_API_SECRET || '6CuUqh4f22Rnw4fT5ETd3nQwHYyyKsyUZeRGNzca8itA',
  LIVEKIT_URL: process.env.LIVEKIT_URL || 'wss://voice-gamesbot-cvf0ngx7.livekit.cloud'
};
