// Server configuration
// Load secrets from environment variables or an untracked local file (server/config.local.js)
let local = {};
try {
  // config.local.js may contain secret values and must NOT be committed
  // Example file: server/config.local.js (see config.sample.js)
  local = require('./config.local');
} catch (e) {
  local = {};
}

const config = {
  PORT: process.env.PORT || local.PORT || 3000,
  SECRET_KEY: process.env.SECRET_KEY || local.SECRET_KEY || 'change-me',
  // LiveKit / API keys: prefer environment variables; if not provided, value will be null
  LK_API_KEY: process.env.LK_API_KEY || local.LK_API_KEY || null,
  LK_API_SECRET: process.env.LK_API_SECRET || local.LK_API_SECRET || null,
  LIVEKIT_URL: process.env.LIVEKIT_URL || local.LIVEKIT_URL || null
};

if (!config.LK_API_KEY || !config.LK_API_SECRET || !config.LIVEKIT_URL) {
  console.warn('Warning: LiveKit configuration is missing. Set LK_API_KEY, LK_API_SECRET and LIVEKIT_URL in environment or server/config.local.js');
}

module.exports = config;
