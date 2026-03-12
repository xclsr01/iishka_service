export function getTelegramWebApp() {
  return window.Telegram?.WebApp;
}

export function prepareTelegramChrome() {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return;
  }

  webApp.ready();
  webApp.expand();
  webApp.setHeaderColor?.('#f3ead7');
  webApp.setBackgroundColor?.('#f7f0e3');
}
