import * as THREE from 'three';
import { MAX_HP, type EntitySnapshot, type Faction, type UnitType } from '@bum-bum-taktik/shared';
import { UNIT_Y_OFFSET, createUnitModel } from './models.js';

// Einheiten als prozedurale Low-Poly-3D-Modelle (models.ts) statt der
// frueheren Draufsicht-Sprites. Jedes Modell zeigt mit Fahrtrichtung nach
// +X; applySnapshot() dreht die ganze Gruppe passend zu snapshot.heading
// (0 = Blick in +X).

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

// HP-Balken als Kamera-zugewandte Sprites (immer lesbar, egal wie die Kamera
// gedreht ist). Beide Sprites sitzen am selben Weltpunkt auf der Drehachse
// der Einheit - so wandert der Balken nicht mit, wenn die Einheit sich dreht.
// Der Fuellstand wird in updateHpBar() ueber Breite + center.x geregelt, damit
// der Balken nach links hin schrumpft statt symmetrisch zur Mitte.
const HP_BAR_WIDTH = 1.1;
const HP_BAR_HEIGHT = 0.14;

const hpBackgroundMaterial = new THREE.SpriteMaterial({ color: 0x222222 });
const hpFillMaterials: Record<Faction, THREE.SpriteMaterial> = {
  player: new THREE.SpriteMaterial({ color: 0x33cc33 }),
  enemy: new THREE.SpriteMaterial({ color: 0xdd3333 }),
};

// Gehackte (gestunnte) Einheiten bekommen einen tuerkisen Balken ueber dem
// HP-Balken (Hacking-Minispiel, docs/KONZEPT.md Abschnitt 9, Phase 3).
// Material bewusst geteilt - Sichtbarkeit wird pro Sprite geschaltet.
const stunMaterial = new THREE.SpriteMaterial({ color: 0x33ddff });

function createHpBar(unitType: UnitType, faction: Faction): THREE.Object3D {
  const barY = UNIT_Y_OFFSET[unitType] + 1.25;

  const background = new THREE.Sprite(hpBackgroundMaterial);
  background.scale.set(HP_BAR_WIDTH, HP_BAR_HEIGHT, 1);
  background.position.y = barY;

  const fill = new THREE.Sprite(hpFillMaterials[faction]);
  fill.name = 'hpFill';
  fill.scale.set(HP_BAR_WIDTH, HP_BAR_HEIGHT, 1);
  fill.position.y = barY;
  // Beide Sprites liegen exakt gleich tief - renderOrder sorgt dafuer, dass
  // die Fuellung zuverlaessig ueber dem Hintergrund gezeichnet wird.
  fill.renderOrder = 1;

  const stun = new THREE.Sprite(stunMaterial);
  stun.name = 'stunMarker';
  stun.scale.set(HP_BAR_WIDTH, HP_BAR_HEIGHT, 1);
  stun.position.y = barY + HP_BAR_HEIGHT * 1.6;
  stun.visible = false;

  // Wie beim Auswahlring: der Balken soll keine Boden-/Einheitenklicks
  // abfangen (THREE.Raycaster testet auch Sprites).
  background.raycast = () => {};
  fill.raycast = () => {};
  stun.raycast = () => {};

  const bar = new THREE.Group();
  bar.add(background, fill, stun);
  return bar;
}

function updateHpBar(group: THREE.Object3D, hp: number, maxHp: number): void {
  const fill = group.getObjectByName('hpFill') as THREE.Sprite | undefined;
  if (!fill) return;
  const fraction = Math.min(Math.max(hp / maxHp, 0.02), 1);
  fill.scale.x = HP_BAR_WIDTH * fraction;
  // center.x so waehlen, dass die linke Kante der Fuellung immer mit der
  // linken Kante des Hintergrunds (Breite 1, center 0.5) buendig bleibt.
  fill.center.x = 1 / (2 * fraction);
}

export function createUnitMesh(unitType: UnitType, faction: Faction): THREE.Group {
  const group = new THREE.Group();
  group.add(createUnitModel(unitType, faction));
  group.add(createSelectionRing());
  group.add(createHpBar(unitType, faction));
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
  updateHpBar(object, snapshot.hp, MAX_HP[snapshot.unitType]);

  const stun = object.getObjectByName('stunMarker');
  if (stun) stun.visible = snapshot.stunned === true;
}
