// Fix mobile viewport issues while respecting Telegram Mini App safe areas.
(function () {
  function setVh() {
    try {
      const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
      const innerHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const stableHeight =
        tg && typeof tg.viewportStableHeight === 'number' ? tg.viewportStableHeight : innerHeight;
      const viewportHeight =
        tg && typeof tg.viewportHeight === 'number' ? tg.viewportHeight : stableHeight;
      const safeTop = tg
        ? Number(tg.contentSafeAreaInset?.top ?? tg.safeAreaInset?.top ?? 0) || 0
        : 0;

      document.documentElement.style.setProperty('--vh', `${innerHeight * 0.01}px`);
      document.documentElement.style.setProperty('--tg-safe-top', `${safeTop}px`);
      document.documentElement.style.setProperty('--tg-viewport-height', `${viewportHeight}px`);
      document.documentElement.style.setProperty(
        '--app-viewport-height',
        `${viewportHeight || innerHeight}px`
      );
    } catch (e) {
      /* ignore */
    }
  }

  setVh();
  window.addEventListener('resize', setVh);
  window.addEventListener('orientationchange', setVh);

  if (
    window.Telegram &&
    window.Telegram.WebApp &&
    typeof window.Telegram.WebApp.onEvent === 'function'
  ) {
    try {
      window.Telegram.WebApp.onEvent('viewportChanged', setVh);
      window.Telegram.WebApp.onEvent('safeAreaChanged', setVh);
      window.Telegram.WebApp.onEvent('contentSafeAreaChanged', setVh);
    } catch (e) {
      /* ignore */
    }
  }
})();
