(() => {
  let room = null,
    generation = 0,
    muted = false;
  const host = document.createElement('div');
  host.id = 'audio-host';
  host.hidden = true;
  document.body.append(host);
  window.gameAudio = {
    async connect({ url, token, channel }) {
      const version = ++generation;
      const old = room;
      room = null;
      host.replaceChildren();
      if (old) await old.disconnect();
      if (version !== generation) return false;
      if (!url || !token) throw Error('Голосовой сервер не настроен');
      const sdk = window.LivekitClient;
      if (!sdk) throw Error('Не удалось загрузить голосовой модуль');
      const next = new sdk.Room();
      room = next;
      next.on(sdk.RoomEvent.TrackSubscribed, (track) => {
        if (room !== next || version !== generation) return;
        if (track.kind === 'audio') {
          const element = track.attach();
          element.muted = muted;
          host.append(element);
        }
      });
      next.on(sdk.RoomEvent.TrackUnsubscribed, (track) =>
        track.detach().forEach((el) => el.remove())
      );
      next.on(sdk.RoomEvent.Disconnected, () => {
        if (room === next) {
          room = null;
          window.appEvents?.emit('audio-disconnected');
        }
      });
      next.on(sdk.RoomEvent.Reconnected, () => {
        if (room === next && version === generation)
          window.appSocket?.emit('media-ready', { channel });
      });
      next.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () =>
        window.appEvents?.emit('audio-status')
      );
      try {
        await next.connect(url, token);
      } catch (e) {
        if (room === next) {
          room = null;
          host.replaceChildren();
        }
        await next.disconnect().catch(() => {});
        if (version !== generation) return false;
        throw e;
      }
      if (version !== generation) {
        await next.disconnect();
        return false;
      }
      window.appSocket.emit('media-ready', { channel });
      return true;
    },
    async microphone(enabled) {
      if (!room) {
        if (enabled) throw Error('Сначала подключите звук');
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(enabled);
    },
    async mute(value) {
      muted = value;
      for (const el of host.querySelectorAll('audio')) el.muted = value;
      if (!value && room) await room.startAudio();
    },
    connected: () => !!room?.state && room.state === 'connected',
    canPlay: () => !!room?.canPlaybackAudio,
    async disconnect() {
      generation++;
      const old = room;
      room = null;
      host.replaceChildren();
      if (old) await old.disconnect();
    },
  };
})();
