// Client-side socket wrapper (centralized)
(function () {
  // tiny event emitter
  function createEmitter() {
    const listeners = {};
    return {
      on: (ev, fn) => ((listeners[ev] || (listeners[ev] = [])).push(fn), fn),
      off: (ev, fn) => (listeners[ev] = (listeners[ev] || []).filter(f => f !== fn)),
      emit: (ev, ...args) => (listeners[ev] || []).forEach(f => f(...args)),
    };
  }

  const emitter = createEmitter();
  window.appEvents = emitter;

  const socket = io();

  function getLivekitToken(username, roomId) {
    socket.emit('get-livekit-token', { username, roomId });
  }

  function createRoom(payload) {
    socket.emit('create-room', payload);
  }

  function joinRoom(roomId, username, photoUrl) {
    socket.emit('join-room', { roomId, username, photoUrl });
  }

  function takeSeat(seatIndex) { socket.emit('take-seat', seatIndex); }
  function leaveSeat() { socket.emit('leave-seat'); }
  function setReady() { socket.emit('set-ready'); }
  function toggleMedia(mic) { socket.emit('toggle-media', { mic }); }
  function sendChatMessage(text) { socket.emit('send-chat-message', text); }

  socket.on('connect', () => emitter.emit('connect'));
  socket.on('disconnect', () => emitter.emit('disconnect'));

  // Map server events to emitter events
  socket.on('error-msg', (msg) => emitter.emit('error-msg', msg));
  socket.on('room-joined', (data) => emitter.emit('room-joined', data));
  socket.on('livekit-token', (token) => emitter.emit('livekit-token', token));
  socket.on('update-room', (data) => emitter.emit('update-room', data));
  socket.on('chat-message', (msg) => emitter.emit('chat-message', msg));
  socket.on('game-started', (d) => emitter.emit('game-started', d));
  socket.on('turn-changed', (d) => emitter.emit('turn-changed', d));
  socket.on('timer-tick', (d) => emitter.emit('timer-tick', d));
  socket.on('discussion-started', (d) => emitter.emit('discussion-started', d));
  socket.on('game-ended', (d) => emitter.emit('game-ended', d));
  socket.on('night-started', (d) => emitter.emit('night-started', d));
  socket.on('night-result', (d) => emitter.emit('night-result', d));
  socket.on('cop-result', (d) => emitter.emit('cop-result', d));

  // expose API
  window.appSocket = {
    socket,
    getLivekitToken,
    createRoom,
    joinRoom,
    takeSeat,
    leaveSeat,
    setReady,
    toggleMedia,
    sendChatMessage,
  };
})();
