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
  const roomName = (room, channel) =>
    channel === 'mafia' ? `${room.mediaRoom}-clan` : room.mediaRoom;
  return {
    enabled,
    async token(room, user) {
      await this.sync(room);
      const channel = engine.mediaChannel(room, user);
      if (!enabled || !channel) return { token: null, url: null, channel, enabled };
      const at = new sdk.AccessToken(config.LK_API_KEY, config.LK_API_SECRET, {
        identity: user.id,
        name: user.username,
        ttl: '5m',
      });
      at.addGrant({
        roomJoin: true,
        room: roomName(room, channel),
        canPublish: false,
        canSubscribe: false,
        canPublishData: false,
        canPublishSources: [2],
      });
      return { token: await at.toJwt(), url: config.LIVEKIT_URL, channel, enabled };
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
                const channel = engine.mediaChannel(room, u);
                if (u.mediaChannel !== channel) {
                  try {
                    await service.removeParticipant(roomName(room, u.mediaChannel), u.id);
                  } catch (e) {
                    if (e.code !== 'not_found') {
                      onFailure(u.id);
                      return;
                    }
                  }
                  u.mediaConnected = false;
                  u.mediaPermission = null;
                  return;
                }
                const permission = {
                  canPublish: engine.canSpeak(room, u),
                  canSubscribe: !!channel,
                  canPublishData: false,
                  canPublishSources: [2],
                  canUpdateMetadata: false,
                };
                const signature = JSON.stringify(permission);
                if (u.mediaPermission === signature) return;
                try {
                  await service.updateParticipant(roomName(room, channel), u.id, { permission });
                  u.mediaPermission = signature;
                } catch (e) {
                  u.mediaPermission = null;
                  u.mediaConnected = false;
                  if (e.code === 'not_found') return;
                  try {
                    await service.removeParticipant(roomName(room, channel), u.id);
                  } catch {}
                  onFailure(u.id);
                }
              })
          );
        });
      queues.set(room.id, job);
      const cleanup = () => {
        if (queues.get(room.id) === job) queues.delete(room.id);
      };
      job.then(cleanup, cleanup);
      return job;
    },
    async remove(room, id) {
      if (service)
        for (const channel of ['room', 'mafia'])
          try {
            await service.removeParticipant(roomName(room, channel), id);
          } catch {}
    },
  };
}
module.exports = { createMedia };
