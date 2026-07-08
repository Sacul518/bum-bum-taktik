import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  return scene;
}

// Platzhalter-Boden fuer den Walking Skeleton. Echtes Terrain aus dem
// Elevation/Moisture-Noise folgt in Phase 1 (docs/KONZEPT.md Abschnitt 3).
// Das Grid dient nur als raeumliche Referenz, damit Bewegung ueberhaupt
// einzuordnen ist - ohne feste Linien wirkt jede Bewegung gleich "im Nichts".
export function createPlaceholderGround(width: number, height: number): THREE.Group {
  const group = new THREE.Group();

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: 0x3a5f3a }),
  );
  plane.rotation.x = -Math.PI / 2;
  group.add(plane);

  const divisions = Math.max(Math.round(Math.max(width, height) / 5), 1);
  const grid = new THREE.GridHelper(Math.max(width, height), divisions, 0x8fd68f, 0x2d4a2d);
  grid.position.y = 0.01;
  group.add(grid);

  return group;
}
