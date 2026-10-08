/**
 * Lichtquellen in echten Räumen (Fenster, Softboxen, Lampen) haben eine Ausdehnung.
 * Ein punktförmiges Richtungslicht erzeugt auf Chrom & poliertem Alu dagegen winzige,
 * extrem helle Glanzpunkte, die "CG" verraten. Wir verbreitern daher die direkte
 * Spiegelung (nicht die Umgebungsreflexion!) über eine Mindest-Rauheit – eine gängige
 * Näherung für flächige Lichtquellen ("roughness modification").
 */
import * as THREE from 'three';

const MIN_DIRECT_ROUGHNESS = '0.34';
let patched = false;

export function applyShaderPatches() {
  if (patched) return;
  patched = true;
  const chunks = THREE.ShaderChunk as Record<string, string>;
  let src = chunks.lights_physical_pars_fragment;
  const before = src;
  src = src.replace(
    'float roughness = material.roughness;\n\n\tfloat alpha = pow2( roughness ); // UE4\'s roughness',
    `float roughness = max( material.roughness, ${MIN_DIRECT_ROUGHNESS} );\n\n\tfloat alpha = pow2( roughness ); // UE4's roughness`,
  );
  src = src.replace(/material\.alphaT, alpha/g, 'max( material.alphaT, alpha ), alpha');
  src = src.replace('float roughness = material.clearcoatRoughness;', `float roughness = max( material.clearcoatRoughness, ${MIN_DIRECT_ROUGHNESS} );`);
  if (src === before) console.warn('Shader-Patch für flächige Lichter konnte nicht angewendet werden.');
  chunks.lights_physical_pars_fragment = src;
}
