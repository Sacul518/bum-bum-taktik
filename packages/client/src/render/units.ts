import * as THREE from 'three';
import type { EntitySnapshot, UnitType } from '@bum-bum-taktik/shared';
import { createUnitAtlasTexture, getUnitUvRect } from './loader.js';

// Einheiten als flache Draufsicht-Sprites aus dem Textur-Atlas (loader.ts,
// docs/KONZEPT.md Abschnitte 4 und 7) statt der frueheren Platzhalter-
// Geometrie. Alle Einheiten teilen sich ein Material (eine Atlas-Textur) und
// pro Typ eine Geometrie mit fest eingerechneten Atlas-UVs - Vorstufe zum
// spaeter geplanten Sprite-Instancing (ein Draw-Call pro Typ).
// Jedes Sprite zeigt mit Fahrtrichtung nach +X; applySnapshot() dreht die
// ganze Gruppe passend zu snapshot.heading (0 = Blick in +X).

// Kantenlaenge des Sprites in Welteinheiten (Kachel = 1x1).
const SPRITE_SIZE: Record<UnitType, number> = {
  tank: 1.2,
  infantry: 0.8,
  boat: 1.5,
  plane: 1.4,
};

// Bodeneinheiten liegen knapp ueber der Kacheloberflaeche (gegen Z-Fighting,
// oberhalb des Auswahlrings bei 0.05); Flugzeuge schweben sichtbar darueber,
// damit sie auch ueber Bergen/anderen Einheiten erkennbar bleiben.
const SPRITE_Y_OFFSET: Record<UnitType, number> = {
  tank: 0.08,
  infantry: 0.08,
  boat: 0.08,
  plane: 3,
};

let atlasMaterial: THREE.MeshBasicMaterial | null = null;

function getAtlasMaterial(): THREE.MeshBasicMaterial {
  if (!atlasMaterial) {
    atlasMaterial = new THREE.MeshBasicMaterial({
      map: createUnitAtlasTexture(),
      side: THREE.DoubleSide,
      // alphaTest statt transparent: schneidet die durchsichtigen Kachel-
      // Raender hart aus, ohne die Sortierprobleme halbtransparenter
      // Materialien (Sprites wuerden sonst je nach Kamerawinkel
      // faelschlich hintereinander verschwinden).
      alphaTest: 0.5,
    });
  }
  return atlasMaterial;
}

const geometryCache = new Map<UnitType, THREE.PlaneGeometry>();

// Eine PlaneGeometry pro Einheitentyp, deren UVs auf die Atlas-Kachel des
// Typs zeigen - dadurch braucht es keinen Material-Wechsel pro Typ. Die
// Geometrie wird zwischen allen Einheiten desselben Typs geteilt.
function getUnitGeometry(unitType: UnitType): THREE.PlaneGeometry {
  let geometry = geometryCache.get(unitType);
  if (!geometry) {
    const size = SPRITE_SIZE[unitType];
    geometry = new THREE.PlaneGeometry(size, size);
    const rect = getUnitUvRect(unitType);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, rect.u0 + uv.getX(i) * (rect.u1 - rect.u0), rect.v0 + uv.getY(i) * (rect.v1 - rect.v0));
    }
    geometryCache.set(unitType, geometry);
  }
  return geometry;
}

function createUnitSprite(unitType: UnitType): THREE.Mesh {
  const mesh = new THREE.Mesh(getUnitGeometry(unitType), getAtlasMaterial());
  // Flach auf den Boden legen. Danach gilt: Canvas-x -> Welt +X und
  // Canvas-y (nach unten) -> Welt +Z, also unverspiegelte Draufsicht -
  // ein Sprite mit Fahrtrichtung nach Canvas-rechts (loader.ts) zeigt bei
  // heading 0 nach Welt-+X, wie zuvor die Platzhalter-Geometrie.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = SPRITE_Y_OFFSET[unitType];
  return mesh;
}

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
  return ring;
}

export function createUnitMesh(unitType: UnitType): THREE.Group {
  const group = new THREE.Group();
  group.add(createUnitSprite(unitType));
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
