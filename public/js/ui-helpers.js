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

// Fix mobile viewport issues while respecting Telegram Mini App safe areas.
(function () {
  function setVh() {
    try {
      const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
      const innerHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const stableHeight = tg && typeof tg.viewportStableHeight === 'number' ? tg.viewportStableHeight : innerHeight;
      const viewportHeight = tg && typeof tg.viewportHeight === 'number' ? tg.viewportHeight : stableHeight;
      const safeTop = tg
        ? Number(tg.contentSafeAreaInset?.top ?? tg.safeAreaInset?.top ?? 0) || 0
        : 0;

      document.documentElement.style.setProperty('--vh', `${innerHeight * 0.01}px`);
      document.documentElement.style.setProperty('--tg-safe-top', `${safeTop}px`);
      document.documentElement.style.setProperty('--tg-viewport-height', `${viewportHeight}px`);
      document.documentElement.style.setProperty('--app-viewport-height', `${viewportHeight || innerHeight}px`);

      if (tg && typeof tg.expand === 'function') {
        try { tg.expand(); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  setVh();
  window.addEventListener('resize', setVh);
  window.addEventListener('orientationchange', setVh);

  if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.onEvent === 'function') {
    try {
      window.Telegram.WebApp.onEvent('viewportChanged', setVh);
    } catch (e) { /* ignore */ }
  }
})();