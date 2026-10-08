import './styles.css';
import { App } from './app';
import { mountUI } from './ui/overlay';

const app = new App(document.getElementById('stage')!, document.getElementById('tooltip')!, document.getElementById('fade')!);
mountUI(app, document.getElementById('ui')!);
app.start().catch((e) => {
  console.error(e);
  app.toast(`Start fehlgeschlagen: ${(e as Error).message}`, 'error');
});

if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __app: App }).__app = app;
