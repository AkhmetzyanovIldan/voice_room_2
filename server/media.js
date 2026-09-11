const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
function createMedia(config, engine, onFailure, sdk = { AccessToken, RoomServiceClient }) {
  const enabled = !!(config.LK_API_KEY && config.LK_API_SECRET && config.LIVEKIT_URL);
  const service = enabled
    ? new sdk.RoomServiceClient(
        config.LIVEKIT_URL.replace(/^ws/, 'http'),
        config.LK_API_KEY,
        config.LK_API_SECRET
      )
    : null;
  const queues = new Map();
  return {
    enabled,
    async token(room, user) {
      if (!enabled) return { token: null, url: null };
      const at = new sdk.AccessToken(config.LK_API_KEY, config.LK_API_SECRET, {
        identity: user.id,
        name: user.username,
        ttl: '5m',
      });
      at.addGrant({
        roomJoin: true,
        room: room.mediaRoom,
        canPublish: false,
        canSubscribe: false,
        canPublishData: false,
        canPublishSources: [2],
      });
      return { token: await at.toJwt(), url: config.LIVEKIT_URL };
    },
    sync(room) {
      if (!service) return Promise.resolve();
      const job = (queues.get(room.id) || Promise.resolve())
        .catch(() => {})
        .then(async () => {
          if (engine.rooms.get(room.id) !== room) return;
          await Promise.all(
            Object.values(room.users)
              .filter((u) => u.mediaConnected)
              .map(async (u) => {
                const permission = {
                  canPublish: engine.canSpeak(room, u),
                  canSubscribe:
                    !!u.connected && !['night', 'night_result'].includes(room.gameStatus),
                  canPublishData: false,
                  canPublishSources: [2],
                  canUpdateMetadata: false,
                };
                const signature = JSON.stringify(permission);
                if (u.mediaPermission === signature) return;
                try {
                  await service.updateParticipant(room.mediaRoom, u.id, { permission });
                  u.mediaPermission = signature;
                } catch {
                  u.mediaPermission = null;
                  u.mediaConnected = false;
                  try {
                    await service.removeParticipant(room.mediaRoom, u.id);
                  } catch {}
                  onFailure(u.id);
                }
              })
          );
        });
      queues.set(room.id, job);
      job.finally(() => {
        if (queues.get(room.id) === job) queues.delete(room.id);
      });
      return job;
    },
    async remove(room, id) {
      if (service)
        try {
          await service.removeParticipant(room.mediaRoom, id);
        } catch {}
    },
  };
}
module.exports = { createMedia };
