(() => {
  let room = null,
    generation = 0,
    muted = false;
  const host = document.createElement('div');
  host.id = 'audio-host';
  host.hidden = true;
  document.body.append(host);
  window.gameAudio = {
    async connect({ url, token }) {
      const version = ++generation;
      if (room) await room.disconnect();
      host.replaceChildren();
      room = null;
      if (!url || !token) throw Error('Голосовой сервер не настроен');
      const sdk = window.LivekitClient;
      if (!sdk) throw Error('Не удалось загрузить голосовой модуль');
      const next = new sdk.Room();
      room = next;
      next.on(sdk.RoomEvent.TrackSubscribed, (track) => {
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
      next.on(sdk.RoomEvent.Reconnected, () => window.appSocket?.emit('media-ready'));
      next.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () =>
        window.appEvents?.emit('audio-status')
      );
      await next.connect(url, token);
      if (version !== generation) {
        await next.disconnect();
        return false;
      }
      window.appSocket.emit('media-ready');
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
