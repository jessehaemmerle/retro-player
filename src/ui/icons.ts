/** Schlanke Linien-Icons (24×24, stroke = currentColor). */
const s = (d: string, fill = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;

export const icons = {
  play: s('<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z"/>', true),
  pause: s('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>', true),
  prev: s('<path d="M18 5.5v13a.7.7 0 0 1-1.1.6L8 12.6a.7.7 0 0 1 0-1.2l8.9-6.5a.7.7 0 0 1 1.1.6z"/><rect x="5" y="5" width="2.4" height="14" rx=".8"/>', true),
  next: s('<path d="M6 5.5v13a.7.7 0 0 0 1.1.6l8.9-6.5a.7.7 0 0 0 0-1.2L7.1 4.9A.7.7 0 0 0 6 5.5z"/><rect x="16.6" y="5" width="2.4" height="14" rx=".8"/>', true),
  shuffle: s('<path d="M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 3.8C14.3 15 15.5 17 17.5 17H21"/><path d="M3 17h3.5c1.3 0 2.2-.5 3-1.3M13.6 8.3c.9-.8 2-1.3 3.9-1.3H21"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>'),
  repeat: s('<path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="m17 3 3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/><path d="m7 21-3-3 3-3"/>'),
  repeatOne: s('<path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="m17 3 3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/><path d="m7 21-3-3 3-3"/><path d="M11.5 10.5 13 9.5v5"/>'),
  search: s('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  library: s('<path d="M4 4v16M9 4v16"/><path d="m14 4.5 5.5 15"/>'),
  settings: s(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ),
  expand: s('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  shrink: s('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  install: s('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  devices: s('<rect x="3" y="4" width="13" height="10" rx="1.5"/><path d="M7 18h5M9.5 14v4"/><rect x="17" y="8" width="4" height="12" rx="1"/>'),
  volume: s('<path d="M4 10v4h3.5L12 18V6L7.5 10H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  eye: s('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  reset: s('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  copy: s('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  logout: s('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 17-5-5 5-5M5 12h11"/>'),
  spotify:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
  // Geräte-Piktogramme für die Auswahl
  turntable: s('<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="10" cy="12" r="5"/><circle cx="10" cy="12" r="1"/><path d="M18.5 7.5v6l-3 2.5"/>'),
  boombox: s('<rect x="2.5" y="8" width="19" height="12" rx="2"/><circle cx="7" cy="14" r="3"/><circle cx="17" cy="14" r="3"/><path d="M7 8V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V8"/><rect x="10.5" y="11" width="3" height="2" rx=".5"/>'),
  amplifier: s('<rect x="2" y="6" width="20" height="12" rx="1.5"/><rect x="4.5" y="8.5" width="9" height="3" rx=".5"/><circle cx="7" cy="15" r="1.2"/><circle cx="11" cy="15" r="1.2"/><circle cx="17.5" cy="12" r="2.6"/>'),
  walkman: s('<rect x="4" y="3" width="16" height="18" rx="2"/><rect x="6.5" y="7" width="11" height="7" rx="1"/><circle cx="9.5" cy="10.5" r="1.3"/><circle cx="14.5" cy="10.5" r="1.3"/><path d="M7 17.5h4"/>'),
  discman: s('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="11" r="5"/><circle cx="12" cy="11" r="1"/><path d="M7.5 18h4"/>'),
};
