/**
 * Bibliothek physikalisch plausibler Materialien. Werte orientieren sich an
 * gemessenen Reflexionsgraden (z. B. Aluminium ~0.91, Chrom ~0.55-0.65 lin.).
 */
import * as THREE from 'three';
import {
  brushedNormal,
  brushedRoughness,
  knurlNormal,
  plasticNormal,
  radialAnisotropy,
  radialBrushedNormal,
  radialBrushedRoughness,
  smudgeRoughness,
  texturedNormal,
  withRepeat,
} from './textures';

type P = THREE.MeshPhysicalMaterialParameters;

export function chrome(extra: P = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.86, 0.87, 0.88),
    metalness: 1,
    roughness: 1,
    roughnessMap: smudgeRoughness(0.06, 0.16, 11, 0.6),
    ...extra,
  });
}

/** Linear gebürstetes Aluminium (Bürstrichtung entlang u). */
export function brushedAluminum(extra: P & { repeat?: [number, number]; anisotropy?: number } = {}): THREE.MeshPhysicalMaterial {
  const { repeat = [1, 1], anisotropy = 0.75, ...rest } = extra;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.8, 0.8, 0.8),
    metalness: 1,
    roughness: 1,
    roughnessMap: withRepeat(brushedRoughness(0.32, 0.06), repeat[0], repeat[1]),
    normalMap: withRepeat(brushedNormal(0.8), repeat[0], repeat[1]),
    normalScale: new THREE.Vector2(0.25, 0.25),
    ...rest,
  });
  m.anisotropy = anisotropy;
  m.anisotropyRotation = 0;
  return m;
}

/** Konzentrisch abgedrehtes Aluminium (Knopfkappen, Plattenteller-Oberseite). Planare UV erforderlich. */
export function spunAluminum(extra: P = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.82, 0.82, 0.82),
    metalness: 1,
    roughness: 1,
    roughnessMap: radialBrushedRoughness(0.22, 0.06),
    normalMap: radialBrushedNormal(1.2),
    normalScale: new THREE.Vector2(0.35, 0.35),
    ...extra,
  });
  m.anisotropy = 0.85;
  m.anisotropyMap = radialAnisotropy();
  return m;
}

/** Gerändeltes Metall für Knopfseiten (UV u läuft um den Umfang). */
export function knurledMetal(ridges: number, extra: P & { diamond?: boolean } = {}): THREE.MeshPhysicalMaterial {
  const { diamond = false, ...rest } = extra;
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.78, 0.78, 0.78),
    metalness: 1,
    roughness: 0.3,
    normalMap: withRepeat(knurlNormal(diamond), ridges, diamond ? ridges / 8 : 1),
    normalScale: new THREE.Vector2(1, 1),
    ...rest,
  });
}

export function plastic(color: THREE.ColorRepresentation, extra: P & { gloss?: number; texture?: 'smooth' | 'fine' | 'coarse'; smudges?: boolean; seed?: number } = {}): THREE.MeshPhysicalMaterial {
  const { gloss = 0.4, texture = 'fine', smudges = true, seed = 1, ...rest } = extra;
  const base = 0.55 - gloss * 0.45; // gloss 1 → 0.1
  const m = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 1,
    roughnessMap: smudges ? smudgeRoughness(base, 0.12 + gloss * 0.15, seed, 0.7) : null,
    normalMap: texture === 'smooth' ? null : texture === 'fine' ? plasticNormal(90, 1) : texturedNormal(70, 4),
    normalScale: new THREE.Vector2(1, 1).multiplyScalar(texture === 'coarse' ? 0.5 : 0.12),
    specularIntensity: 0.6,
    ...rest,
  });
  if (!smudges) m.roughness = base;
  return m;
}

/** Lackierte Fläche mit Klarlack (z. B. Gehäuse, Klavierlack). */
export function lacquer(color: THREE.ColorRepresentation, extra: P = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: smudgeRoughness(0.06, 0.18, 4, 0.8),
    normalMap: plasticNormal(40, 0.8, 8),
    normalScale: new THREE.Vector2(0.05, 0.05),
    ...extra,
  });
}

/** Eloxiertes, gebürstetes Aluminium in Farbe (Walkman-Gehäuse). */
export function anodized(color: THREE.ColorRepresentation, extra: P & { repeat?: [number, number] } = {}): THREE.MeshPhysicalMaterial {
  const { repeat = [1, 1], ...rest } = extra;
  const m = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 1,
    roughness: 1,
    roughnessMap: withRepeat(brushedRoughness(0.36, 0.05, 4), repeat[0], repeat[1]),
    normalMap: withRepeat(brushedNormal(0.6, 4), repeat[0], repeat[1]),
    normalScale: new THREE.Vector2(0.2, 0.2),
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
    ...rest,
  });
  m.anisotropy = 0.6;
  return m;
}

export function rubber(color: THREE.ColorRepresentation = '#151515', extra: P = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.82,
    normalMap: texturedNormal(120, 2.5, 12),
    normalScale: new THREE.Vector2(0.4, 0.4),
    sheen: 0.3,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color('#444'),
    ...extra,
  });
}

/** Klares oder getöntes Acryl/Glas mit echter Transmission. */
export function glass(extra: P & { tint?: THREE.ColorRepresentation; smoke?: number } = {}): THREE.MeshPhysicalMaterial {
  const { tint = '#ffffff', smoke = 0, ...rest } = extra;
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 1,
    roughnessMap: smudgeRoughness(0.03, 0.12, 21, 0.6),
    transmission: 1,
    thickness: 0.002,
    ior: 1.49,
    attenuationColor: new THREE.Color(tint),
    attenuationDistance: smoke > 0 ? 0.002 / smoke : Infinity,
    specularIntensity: 1,
    ...rest,
  });
}

/** Getöntes Sichtfenster ohne Transmission (günstig): transparent, spiegelnd. */
export function tintedWindow(tint: THREE.ColorRepresentation, opacity = 0.55, extra: P = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0,
    roughness: 1,
    roughnessMap: smudgeRoughness(0.04, 0.14, 23, 0.6),
    transparent: true,
    opacity,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ...extra,
  });
}

/** Stoff/Schaumstoff mit Sheen (Kopfhörerpolster, Lautsprecherstoff). */
export function fabric(color: THREE.ColorRepresentation, extra: P = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.95,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.25),
    normalMap: texturedNormal(160, 5, 31),
    normalScale: new THREE.Vector2(0.7, 0.7),
    ...extra,
  });
}

/** Lack-/Siebdruck-Farbe (matt) für kleine Details. */
export function paint(color: THREE.ColorRepresentation, roughness = 0.55): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0 });
}

/** Leuchtendes Element: HDR-Emission > 1, damit Bloom greift. */
export function emissive(color: THREE.ColorRepresentation, intensity = 3): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

/** Holzfurnier mit Seidenmatt-Lack (Texturen kommen vom Stage-Loader). */
export function woodVeneer(
  tex: { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture },
  repeat: [number, number],
  extra: P & { rotation?: number; offset?: [number, number] } = {},
): THREE.MeshPhysicalMaterial {
  const { rotation = 0, offset = [0, 0], ...rest } = extra;
  const prep = (t: THREE.Texture) => {
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(...repeat);
    c.offset.set(...offset);
    c.rotation = rotation;
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshPhysicalMaterial({
    map: prep(tex.map),
    normalMap: prep(tex.normal),
    roughnessMap: prep(tex.rough),
    roughness: 0.9,
    normalScale: new THREE.Vector2(0.5, 0.5),
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    ...rest,
  });
}
