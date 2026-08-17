// Simple game phase manager for server-side game logic (Mafia phases example)
// Keeps per-room timers and emits phase-change events on the room's events emitter

const timers = new Map();

function startGameCycle(room, options = {}) {
  // options: durations: { day: 60000, night: 30000 }
  const durations = Object.assign({ day: 60_000, night: 30_000 }, options.durations || {});

  stopGameCycle(room.id);

  let current = room.state.phase || 'day';

  function nextPhase() {
    current = current === 'day' ? 'night' : 'day';
    room.state.phase = current;
    room.events.emit('phase:change', current);
  }

  // set repeating cycle
  const interval = setInterval(() => {
    nextPhase();
  }, current === 'day' ? durations.day : durations.night);

  // store metadata so we can stop later
  timers.set(room.id, { interval, durations, current });

  // immediately emit current phase so clients sync
  room.events.emit('phase:change', current);
}

function stopGameCycle(roomId) {
  const meta = timers.get(roomId);
  if (!meta) return;
  clearInterval(meta.interval);
  timers.delete(roomId);
}

module.exports = {
  startGameCycle,
  stopGameCycle,
};
