(() => {
  const listeners = new Map();
  const events = {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    emit(name, ...args) {
      for (const fn of listeners.get(name) || []) fn(...args);
    },
  };
  let token = '';
  try {
    token = sessionStorage.getItem('mafia-session') || '';
  } catch {}
  const socket = io({
    autoConnect: false,
    auth: { sessionToken: token, initData: window.Telegram?.WebApp?.initData || '' },
  });
  socket.on('session', (data) => {
    socket.auth.sessionToken = data.sessionToken;
    try {
      sessionStorage.setItem('mafia-session', data.sessionToken);
    } catch {}
    events.emit('session', data);
  });
  for (const name of [
    'connect',
    'disconnect',
    'connect_error',
    'error-msg',
    'room-joined',
    'room-left',
    'update-room',
    'private-state',
    'game-started',
    'game-ended',
    'night-started',
    'night-result',
    'turn-changed',
    'discussion-started',
    'voting-started',
    'day-vote-result',
    'last-word-started',
    'night-action-ack',
    'day-vote-ack',
    'investigation-result',
    'charmed',
    'livekit-token',
    'media-error',
    'chat-message',
    'session-replaced',
  ])
    socket.on(name, (...args) => events.emit(name, ...args));
  window.appEvents = events;
  window.appSocket = {
    socket,
    emit: (name, data) => (data === undefined ? socket.emit(name) : socket.emit(name, data)),
  };
})();
