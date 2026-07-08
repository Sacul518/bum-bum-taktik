import * as THREE from 'three';
import type { EntitySnapshot, UnitType } from '@bum-bum-taktik/shared';

// Platzhalter-Formen pro Einheitentyp fuer den Pathfinding-Smoke-Test - noch
// keine Sprites/Textur-Atlanten, das kommt mit der Asset-Pipeline in Phase 1
// (docs/KONZEPT.md Abschnitt 7). Jede Form zeigt ihre Fahrtrichtung durch
// Laenglichkeit/Spitze in +X an; applySnapshot() dreht die ganze Gruppe
// passend zu snapshot.heading (0 = Blick in +X).

function createTankMesh(): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.6, 0.8),
    new THREE.MeshBasicMaterial({ color: 0x2f8f3d }),
  );
  mesh.position.y = 0.3;
  return mesh;
}

function createInfantryMesh(): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.8, 12),
    new THREE.MeshBasicMaterial({ color: 0x2266dd }),
  );
  mesh.position.y = 0.4;
  return mesh;
}

function createBoatMesh(): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.8, 4, 8),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a }),
  );
  // CapsuleGeometry steht standardmaessig aufrecht (laengs der Y-Achse) -
  // um Z kippen, damit sie liegend auf dem Wasser erscheint.
  mesh.rotation.z = Math.PI / 2;
  mesh.position.y = 0.3;
  return mesh;
}

function createPlaneMesh(): THREE.Object3D {
  const geometry = new THREE.BufferGeometry();
  // Flaches Dreieck in der Boden-Ebene (y=0 lokal), Spitze nach +X.
  const vertices = new Float32Array([0.8, 0, 0, -0.5, 0, 0.5, -0.5, 0, -0.5]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 2]);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xdd2222, side: THREE.DoubleSide }));
  // Sichtbar ueber Land-/Wassereinheiten schwebend, damit Flugzeuge auch
  // ueber Bergen/anderen Einheiten erkennbar bleiben.
  mesh.position.y = 3;
  return mesh;
}

const MESH_FACTORIES: Record<UnitType, () => THREE.Object3D> = {
  tank: createTankMesh,
  infantry: createInfantryMesh,
  boat: createBoatMesh,
  plane: createPlaneMesh,
};

// Auswahlring liegt flach auf dem Boden (auch unter Flugzeugen, deren Mesh
// erhoeht schwebt) - dient als "Schatten"-Marker, welche Einheit gerade
// selektiert ist (docs/KONZEPT.md Abschnitt 5.3).
function createSelectionRing(): THREE.Object3D {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.78, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05; // knapp ueber dem Terrain gegen Z-Fighting
  ring.visible = false;
  ring.name = 'selectionRing';
  // THREE.Raycaster testet auch unsichtbare Objekte. Ohne diese Ausnahme
  // faengt der Ring der selektierten Einheit Bodenklicks in seinem Radius ab -
  // ein Move-Befehl knapp neben die Einheit wuerde sie nur erneut selektieren.
  ring.raycast = () => {};
  return ring;
}

export function createUnitMesh(unitType: UnitType): THREE.Group {
  const group = new THREE.Group();
  group.add(MESH_FACTORIES[unitType]());
  group.add(createSelectionRing());
  return group;
}

export function setSelected(group: THREE.Object3D, selected: boolean): void {
  const ring = group.getObjectByName('selectionRing');
  if (ring) ring.visible = selected;
}

// Server-x/y sind die Draufsicht-Koordinaten; in der Three.js-Szene bleibt y
// die Hoehe, darum wird Server-y auf die Welt-z-Achse gemappt. terrainHeight
// kommt von sampleElevation() (render/terrain.ts) - ohne sie wuerden Fahrzeuge
// immer bei y=0 stehen und in Huegeln einsinken bzw. ueber Wasser schweben.
export function applySnapshot(object: THREE.Object3D, snapshot: EntitySnapshot, terrainHeight: number): void {
  object.position.x = snapshot.x;
  object.position.y = terrainHeight;
  object.position.z = snapshot.y;
  object.rotation.y = -snapshot.heading;
}
