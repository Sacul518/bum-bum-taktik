import * as THREE from 'three';
import type { EntitySnapshot } from '@bum-bum-taktik/shared';

// Platzhalter-Darstellung pro Einheit fuer den Walking Skeleton: Wuerfel-
// Koerper + kleine gelbe "Nase" in Fahrtrichtung, damit man am Drehwinkel
// erkennt, wohin die Einheit gerade blickt. Echtes Sprite-Instancing mit
// Textur-Atlanten folgt in Phase 1.
const BODY_SIZE = 2;
const NOSE_SIZE = 0.6;

export function createUnitMesh(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE),
    new THREE.MeshBasicMaterial({ color: 0xdd3333 }),
  );
  body.position.y = BODY_SIZE / 2;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(NOSE_SIZE, NOSE_SIZE, NOSE_SIZE),
    new THREE.MeshBasicMaterial({ color: 0xffd23f }),
  );
  nose.position.set(BODY_SIZE / 2, BODY_SIZE / 2, 0);
  group.add(nose);

  return group;
}

// Server-x/y sind die Draufsicht-Koordinaten; in der Three.js-Szene bleibt y
// die Hoehe, darum wird Server-y auf die Welt-z-Achse gemappt.
export function applySnapshot(object: THREE.Object3D, snapshot: EntitySnapshot): void {
  object.position.x = snapshot.x;
  object.position.z = snapshot.y;
  object.rotation.y = -snapshot.heading;
}
