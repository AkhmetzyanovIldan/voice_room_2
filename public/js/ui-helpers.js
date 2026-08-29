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

// Fix mobile viewport 100vh issues: set CSS variable --vh based on real innerHeight
(function () {
  function setVh() {
    try {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    } catch (e) { /* ignore */ }
  }
  setVh();
  window.addEventListener('resize', setVh);
  // Try to react to Telegram WebApp viewport changes if available
  if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.onEvent === 'function') {
    try {
      window.Telegram.WebApp.onEvent('viewportChanged', setVh);
    } catch (e) { /* ignore */ }
  }
})();