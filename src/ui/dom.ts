/** Kleine DOM-Helfer. Text wird immer als textContent gesetzt (kein HTML aus Fremddaten). */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const svgCache = new Map<string, SVGElement>();
const parser = new DOMParser();

/** Wandelt ein (statisches, eigenes) Icon-SVG in einen DOM-Knoten um. */
export function svg(markup: string): SVGElement {
  let node = svgCache.get(markup);
  if (!node) {
    const doc = parser.parseFromString(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml');
    node = doc.documentElement as unknown as SVGElement;
    svgCache.set(markup, node);
  }
  return document.importNode(node, true);
}

/** Setzt Icon + Beschriftung eines Elements. */
export function setIconLabel(target: HTMLElement, iconMarkup: string, label: string, labelClass = 'label') {
  const children: Node[] = [];
  if (iconMarkup) children.push(svg(iconMarkup));
  if (label) children.push(el('span', labelClass, label));
  target.replaceChildren(...children);
}

export function iconButton(cls: string, iconMarkup: string, label: string, title: string, onClick: () => void, plainLabel = false): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  setIconLabel(b, iconMarkup, label, plainLabel ? '' : 'label');
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}
