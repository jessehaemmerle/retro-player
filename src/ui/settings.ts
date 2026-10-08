import type { App } from '../app';
import type { Quality } from '../engine/stage';
import { getClientId, getRedirectUri, isLoggedIn, login, logout, redirectUriProblem, setClientId } from '../spotify/auth';
import { icons } from './icons';
import { el, iconButton } from './dom';

export class Settings {
  isOpen = false;
  private backdrop = el('div', 'dialog-backdrop');
  private dialog = el('div', 'dialog glass');
  private idField = el('input', 'field');

  constructor(
    private app: App,
    root: HTMLElement,
  ) {
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-label', 'Einstellungen');
    this.backdrop.append(this.dialog);
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    root.append(this.backdrop);
  }

  open(focusSetup = false) {
    this.render();
    this.isOpen = true;
    this.backdrop.classList.add('open');
    if (focusSetup) setTimeout(() => this.idField.focus(), 200);
  }

  close() {
    this.isOpen = false;
    this.backdrop.classList.remove('open');
  }

  private render() {
    const d = this.dialog;
    d.replaceChildren();
    const head = el('div', 'head');
    head.append(el('h2', '', 'Einstellungen'));
    const close = iconButton('icon-btn close', icons.close, '', 'Schließen', () => this.close());
    head.append(close);
    d.append(head);

    // --- Spotify
    d.append(el('h3', '', 'Spotify'));
    const loggedIn = isLoggedIn() && this.app.playback.kind === 'spotify';
    if (loggedIn) {
      d.append(el('p', '', 'Du bist mit Spotify verbunden. Für die Wiedergabe direkt im Browser ist Spotify Premium nötig – ohne Premium lässt sich ein anderes Spotify-Gerät nur anzeigen.'));
      const row = el('div', 'row');
      row.append(
        iconButton('icon-btn', icons.logout, 'Abmelden', 'Abmelden', () => {
          logout();
          this.app.useDemo();
          this.close();
          this.app.toast('Abgemeldet – Demo-Modus aktiv.');
        }),
      );
      d.append(row);
    } else {
      const redirect = getRedirectUri();
      const problem = redirectUriProblem();
      d.append(el('p', '', 'Spotify erlaubt Drittanbieter-Playern den Zugriff nur über eine eigene, kostenlose App im Spotify-Developer-Dashboard. Das dauert zwei Minuten:'));
      const ol = el('ol');
      const li1 = el('li');
      const link = el('a', '', 'developer.spotify.com/dashboard');
      link.href = 'https://developer.spotify.com/dashboard';
      link.target = '_blank';
      link.rel = 'noopener';
      li1.append('Öffne ', link, ' und klicke auf „Create app“.');
      const li2 = el('li');
      const code = el('code', '', redirect);
      const copy = iconButton('icon-btn', icons.copy, '', 'Redirect-URI kopieren', () => {
        navigator.clipboard?.writeText(redirect).then(() => this.app.toast('Redirect-URI kopiert.'));
      });
      copy.style.height = '28px';
      copy.style.verticalAlign = 'middle';
      li2.append('Trage als Redirect URI exakt ein: ', code, ' ', copy);
      const li3 = el('li', '', 'Wähle bei den APIs „Web API“ und „Web Playback SDK“ und speichere.');
      const li4 = el('li', '', 'Kopiere die „Client ID“ hierher und klicke auf „Speichern & verbinden“.');
      const li5 = el('li', '', 'Im Development Mode unter „User Management“ die Spotify-E-Mail-Adressen aller Nutzer eintragen (max. 5). Der App-Besitzer braucht Spotify Premium.');
      ol.append(li1, li2, li3, li4, li5);
      d.append(ol);
      if (problem) {
        const warn = el('p', '', `⚠️ ${problem}`);
        warn.style.color = 'var(--danger)';
        d.append(warn);
      }
      const row = el('div', 'row');
      this.idField.placeholder = 'Client ID (32 Zeichen)';
      this.idField.value = getClientId();
      this.idField.spellcheck = false;
      this.idField.autocomplete = 'off';
      const save = iconButton('icon-btn spotify', icons.spotify, 'Speichern & verbinden', 'Speichern & verbinden', async () => {
        const v = this.idField.value.trim();
        if (!/^[0-9a-f]{32}$/i.test(v)) {
          this.app.toast('Die Client ID besteht aus 32 Hex-Zeichen (0-9, a-f).', 'error');
          return;
        }
        setClientId(v);
        try {
          await login();
        } catch (e) {
          this.app.toast((e as Error).message, 'error');
        }
      });
      save.style.height = '42px';
      row.append(this.idField, save);
      d.append(row);
    }

    // --- Darstellung
    d.append(el('h3', '', 'Darstellung'));
    const qRow = el('div', 'row');
    qRow.append(el('span', '', 'Renderqualität'));
    const seg = el('div', 'segmented');
    const labels: Array<[Quality, string]> = [
      ['high', 'Hoch'],
      ['medium', 'Mittel'],
      ['low', 'Niedrig'],
    ];
    for (const [q, label] of labels) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.app.quality === q));
      b.addEventListener('click', () => {
        this.app.setQuality(q);
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      seg.append(b);
    }
    qRow.style.justifyContent = 'space-between';
    qRow.append(seg);
    d.append(qRow);
    d.append(el('p', 'credits', 'Hoch: Umgebungsverdeckung (AO), Bloom, volle Auflösung. Bei ruckelnder Darstellung „Mittel“ oder „Niedrig“ wählen.'));
    const sfx = el('label', 'switch');
    const sfxInput = el('input');
    sfxInput.type = 'checkbox';
    sfxInput.checked = this.app.sfx.enabled;
    sfxInput.addEventListener('change', () => this.app.setSfx(sfxInput.checked));
    sfx.append(el('span', '', 'Mechanik-Geräusche & Vinyl-Knistern'), sfxInput);
    d.append(sfx);

    // --- Installation
    d.append(el('h3', '', 'Als App installieren'));
    d.append(
      el(
        'p',
        '',
        'Chrome/Edge: Installieren-Symbol in der Adressleiste oder „Installieren“ oben rechts. Safari (macOS): Ablage → Zum Dock hinzufügen. iOS: Teilen → Zum Home-Bildschirm. Danach startet der Retro Player in einem eigenen Fenster.',
      ),
    );

    // --- Tastatur
    d.append(el('h3', '', 'Tastatur'));
    const kbd = el('div', 'kbd');
    const keys: Array<[string, string]> = [
      ['Leertaste', 'Play / Pause'],
      ['← / →', '10 Sekunden zurück / vor'],
      ['Shift + ← / →', 'Vorheriger / nächster Titel'],
      ['↑ / ↓', 'Lautstärke'],
      ['1 – 5', 'Gerät wechseln'],
      ['L', 'Bibliothek'],
      ['F', 'Vollbild'],
      ['R / Doppelklick', 'Ansicht zurücksetzen'],
    ];
    for (const [k, v] of keys) kbd.append(el('kbd', '', k), el('span', '', v));
    d.append(kbd);

    // --- Über
    d.append(el('h3', '', 'Über'));
    d.append(
      el(
        'p',
        'credits',
        'Echtzeit-3D mit three.js (MIT). HDRIs & Texturen: Poly Haven (CC0). Segmentschriften: DSEG (OFL). Schriften: Jost, Barlow Condensed, Michroma (OFL), Permanent Marker (Apache 2.0). Gerätenamen sind fiktiv. Spotify ist eine Marke der Spotify AB; dieses Projekt steht in keiner Verbindung zu Spotify. Cover werden über die Spotify-API geladen und unverändert in der Titelanzeige gezeigt.',
      ),
    );
  }
}
