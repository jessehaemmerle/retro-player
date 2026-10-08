/** PWA: Service Worker registrieren und „Installieren“-Knopf anbieten. */
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function setupInstall(button: HTMLButtonElement, notify: (msg: string) => void) {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    registerSW({
      immediate: true,
      onOfflineReady: () => notify('Retro Player ist jetzt auch offline startklar.'),
    });
  }

  let deferred: BeforeInstallPromptEvent | null = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
  if (standalone) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    button.hidden = true;
    deferred = null;
    notify('Installiert! Du findest den Retro Player jetzt bei deinen Apps.');
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') button.hidden = true;
    deferred = null;
  });
}
