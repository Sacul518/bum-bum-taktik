import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Licht fuer die MeshLambertMaterial-Einheitenmodelle (models.ts) - das
  // Terrain nutzt unbeleuchtete Materialien und bleibt davon unberuehrt.
  // Hemisphaere = weiche Grundhelligkeit (Himmel/Boden), Directional =
  // schraeges "Sonnenlicht", damit die Modellflaechen plastisch wirken.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x39445a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(60, 100, 40);
  scene.add(sun);

  return scene;
}
