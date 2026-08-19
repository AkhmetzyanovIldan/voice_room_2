// small helpers for UI
window.getSeatIndexByUserId = function (userId) {
  try {
    const state = window.__lastRoomState;
    if (!state || !state.seats) return -1;
    const seats = state.seats;
    for (const k in seats) {
      if (seats[k] === userId) return parseInt(k, 10);
    }
    return -1;
  } catch (e) {
    return -1;
  }
};

// expose to global
function getSeatIndexByUserId(id) { return window.getSeatIndexByUserId(id); }
window.getSeatIndexByUserId = getSeatIndexByUserId;