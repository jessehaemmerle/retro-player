/** Geometrie-Helfer: abgerundete Kanten überall – nichts in der Realität ist messerscharf. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const mm = (v: number) => v / 1000;

export function roundedBox(w: number, h: number, d: number, r: number, seg = 4): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
}

export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function roundedRectPath(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Path {
  const p = new THREE.Path();
  const s = roundedRectShape(w, h, r, cx, cy);
  p.curves = s.curves;
  return p;
}

/**
 * Extrudiert eine Form entlang +z mit Fase und setzt planare UVs (0..1 über die
 * Bounding-Box) auf Vorder- und Rückseite – ideal für bedruckte Platten.
 */
export function extrudePanel(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 12): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-5, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? 3 : 0,
    curveSegments,
  });
  geo.translate(0, 0, bevel);
  planarUV(geo, 'z');
  geo.computeVertexNormals();
  return geo;
}

/** Planare UVs aus der Bounding-Box entlang einer Achse projizieren (für Flächen mit |n·axis| > 0.5). */
export function planarUV(geo: THREE.BufferGeometry, axis: 'x' | 'y' | 'z', onlyFacing = true) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const [ua, va] = axis === 'z' ? ['x', 'y'] : axis === 'y' ? ['x', 'z'] : ['z', 'y'];
  const size = new THREE.Vector3();
  bb.getSize(size);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (onlyFacing && nrm) {
      n.fromBufferAttribute(nrm, i);
      if (Math.abs(n[axis]) < 0.5) continue;
    }
    let u = (v[ua as 'x'] - bb.min[ua as 'x']) / (size[ua as 'x'] || 1);
    let w = (v[va as 'y'] - bb.min[va as 'y']) / (size[va as 'y'] || 1);
    if (axis === 'y') w = 1 - w; // Draufsicht: -z ist "oben" im Bild
    if (axis === 'x') u = 1 - u;
    uv.setXY(i, u, w);
  }
  uv.needsUpdate = true;
}

/**
 * Rotationskörper aus einem Profil [radius, höhe] (von unten nach oben).
 * Liefert glatte Normalen über scharfe Profilknicke nur, wenn `smooth` gesetzt ist.
 */
export function lathe(profile: Array<[number, number]>, segments = 64, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const geo = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  return geo;
}

/** Profil mit abgerundeter Kante zwischen zwei Punkten erzeugen (Viertelkreis). */
export function filletProfile(points: Array<[number, number, number?]>, steps = 4): Array<[number, number]> {
  // points: [r, y, filletRadius?] – Fillet am jeweiligen Eckpunkt
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    const [r, y, f] = points[i];
    if (!f || i === 0 || i === points.length - 1) {
      out.push([r, y]);
      continue;
    }
    const prev = new THREE.Vector2(points[i - 1][0], points[i - 1][1]);
    const cur = new THREE.Vector2(r, y);
    const next = new THREE.Vector2(points[i + 1][0], points[i + 1][1]);
    const d1 = prev.clone().sub(cur).normalize();
    const d2 = next.clone().sub(cur).normalize();
    const a = cur.clone().addScaledVector(d1, f);
    const b = cur.clone().addScaledVector(d2, f);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratische Bézierkurve durch die Ecke
      const p = a.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(cur, 2 * (1 - t) * t).addScaledVector(b, t * t);
      out.push([p.x, p.y]);
    }
  }
  return out;
}

/** Kreisscheibe in der xz-Ebene (Normale +y) mit planarer UV (Mittelpunkt 0.5/0.5). */
export function disc(radius: number, segments = 96, innerRadius = 0): THREE.BufferGeometry {
  const geo = innerRadius > 0 ? new THREE.RingGeometry(innerRadius, radius, segments, 1) : new THREE.CircleGeometry(radius, segments);
  // Ring-/Circle-UVs sind bereits planar über [-r, r] → 0..1
  if (innerRadius > 0) {
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * radius) + 0.5, pos.getY(i) / (2 * radius) + 0.5);
  }
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Zylinder mit verrundeten Kanten (z. B. Füße, Tasten, Knöpfe). Achse = y, Boden bei y = 0. */
export function roundedCylinder(radius: number, height: number, fillet: number, segments = 64, topFillet = fillet): THREE.BufferGeometry {
  const prof = filletProfile(
    [
      [0, 0],
      [radius, 0, fillet],
      [radius, height, topFillet],
      [0, height],
    ],
    5,
  );
  const geo = lathe(prof, segments);
  return geo;
}

/** Glatt schattierte Röhre entlang einer Kurve. */
export function tube(curve: THREE.Curve<THREE.Vector3>, radius: number, tubular = 64, radial = 24): THREE.BufferGeometry {
  return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
}

/** Kreuzschlitzschraube: flacher Kopf + Schlitz (zwei dunkle Kerben). */
export function screwHead(radius: number, metal: THREE.Material, slotMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(
    lathe(filletProfile([[0, 0], [radius, 0], [radius, radius * 0.25, radius * 0.15], [radius * 0.75, radius * 0.5, radius * 0.25], [0, radius * 0.55]], 3), 32),
    metal,
  );
  g.add(head);
  const slotGeo = new THREE.BoxGeometry(radius * 1.2, radius * 0.3, radius * 0.18);
  const s1 = new THREE.Mesh(slotGeo, slotMat);
  s1.position.y = radius * 0.45;
  const s2 = s1.clone();
  s2.rotation.y = Math.PI / 2;
  g.add(s1, s2);
  g.rotation.y = Math.random() * Math.PI;
  return g;
}

export function smoothNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-6);
  merged.computeVertexNormals();
  return merged;
}

/** Schatten werfen/empfangen für alle Meshes einer Gruppe. */
export function shadows(obj: THREE.Object3D, cast = true, receive = true) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

/**
 * Welt-/Objektraum-Projektion der UVs je nach dominanter Normalenrichtung
 * (wie Box-Mapping). Verhindert verzerrte Holzmaserung auf flachen Quadern.
 * `scale` = Meter pro Texturkachel. Maserung läuft entlang x.
 */
export function boxProjectUV(geo: THREE.BufferGeometry, scale: number, offset: [number, number] = [0, 0]) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) {
      u = x; v = z;
    } else if (az >= ax) {
      u = x; v = y;
    } else {
      u = z; v = y;
    }
    uv.setXY(i, u / scale + offset[0], v / scale + offset[1]);
  }
  uv.needsUpdate = true;
  return geo;
}
