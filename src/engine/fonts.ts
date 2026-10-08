/**
 * Lokal gebündelte Schriften (OFL/Apache) für Gerätebeschriftungen und Segmentanzeigen.
 * Werden per FontFace-API geladen, bevor Canvas-Texturen gezeichnet werden.
 */
import jost400 from '@fontsource/jost/files/jost-latin-400-normal.woff2?url';
import jost500 from '@fontsource/jost/files/jost-latin-500-normal.woff2?url';
import jost600 from '@fontsource/jost/files/jost-latin-600-normal.woff2?url';
import jost700 from '@fontsource/jost/files/jost-latin-700-normal.woff2?url';
import barlow500 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2?url';
import barlow600 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2?url';
import barlow700 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2?url';
import michroma from '@fontsource/michroma/files/michroma-latin-400-normal.woff2?url';
import marker from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url';
import dseg7 from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2?url';
import dseg7i from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-BoldItalic.woff2?url';
import dseg14 from 'dseg/fonts/DSEG14-Classic/DSEG14Classic-Bold.woff2?url';
import dseg14i from 'dseg/fonts/DSEG14-Classic/DSEG14Classic-BoldItalic.woff2?url';

const faces: Array<[string, string, string, string?]> = [
  ['Jost', jost400, '400'],
  ['Jost', jost500, '500'],
  ['Jost', jost600, '600'],
  ['Jost', jost700, '700'],
  ['Barlow Condensed', barlow500, '500'],
  ['Barlow Condensed', barlow600, '600'],
  ['Barlow Condensed', barlow700, '700'],
  ['Michroma', michroma, '400'],
  ['Permanent Marker', marker, '400'],
  ['DSEG7', dseg7, '700'],
  ['DSEG7', dseg7i, '700', 'italic'],
  ['DSEG14', dseg14, '700'],
  ['DSEG14', dseg14i, '700', 'italic'],
];

let loaded: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  loaded ??= Promise.all(
    faces.map(async ([family, url, weight, style]) => {
      const face = new FontFace(family, `url(${url})`, { weight, style: style ?? 'normal' });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return loaded;
}

/** Segmentanzeigen können nur ASCII – Umlaute & Sonderzeichen werden ersetzt. */
export function toSegmentText(s: string, allowLower = false): string {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'AE', Ö: 'OE', Ü: 'UE', ß: 'ss', '&': '+', '–': '-', '—': '-', '’': "'" };
  let out = s.replace(/[äöüÄÖÜß&–—’]/g, (c) => map[c] ?? c);
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  out = out.replace(/[^\x20-\x7e]/g, ' ');
  return allowLower ? out : out.toUpperCase();
}
