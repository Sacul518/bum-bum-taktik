import * as THREE from 'three';
import { COMBAT_STATS, type EntitySnapshot, type Faction, type UnitType } from '@bum-bum-taktik/shared';
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

let atlasTexture: THREE.Texture | null = null;

// Ein Material pro Fraktion (beide teilen sich dieselbe Atlas-Textur):
// die MeshBasicMaterial-Farbe multipliziert die Textur, Feind-Einheiten
// bekommen so eine rote Toenung ohne eigene Sprites (Platzhalter bis zum
// Grafik-Feinschliff in Phase 4).
const FACTION_TINT: Record<Faction, number> = {
  player: 0xffffff,
  enemy: 0xff7777,
};

const atlasMaterials = new Map<Faction, THREE.MeshBasicMaterial>();

// Die Atlas-Textur laedt inzwischen echte Sprite-Bilder (loader.ts) und ist
// deshalb asynchron. preloadUnitAtlas() muss einmal awaited werden, bevor
// die erste Einheit erzeugt wird (main.ts vor dem Verbindungsaufbau) - danach
// bleibt createUnitMesh() synchron, weil die Textur schon im Cache liegt.
export async function preloadUnitAtlas(): Promise<void> {
  if (atlasTexture) return;
  atlasTexture = await createUnitAtlasTexture();
}

function getAtlasMaterial(faction: Faction): THREE.MeshBasicMaterial {
  if (!atlasTexture) throw new Error('Atlas noch nicht geladen - preloadUnitAtlas() zuerst awaiten');
  let material = atlasMaterials.get(faction);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: atlasTexture,
      color: FACTION_TINT[faction],
      side: THREE.DoubleSide,
      // alphaTest statt transparent: schneidet die durchsichtigen Kachel-
      // Raender hart aus, ohne die Sortierprobleme halbtransparenter
      // Materialien (Sprites wuerden sonst je nach Kamerawinkel
      // faelschlich hintereinander verschwinden).
      alphaTest: 0.5,
    });
    atlasMaterials.set(faction, material);
  }
  return material;
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

function createUnitSprite(unitType: UnitType, faction: Faction): THREE.Mesh {
  const mesh = new THREE.Mesh(getUnitGeometry(unitType), getAtlasMaterial(faction));
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

function createHpBar(unitType: UnitType, faction: Faction): THREE.Object3D {
  const barY = SPRITE_Y_OFFSET[unitType] + 1.1;

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

  // Wie beim Auswahlring: der Balken soll keine Boden-/Einheitenklicks
  // abfangen (THREE.Raycaster testet auch Sprites).
  background.raycast = () => {};
  fill.raycast = () => {};

  const bar = new THREE.Group();
  bar.add(background, fill);
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
  group.add(createUnitSprite(unitType, faction));
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
  updateHpBar(object, snapshot.hp, COMBAT_STATS[snapshot.unitType].maxHp);
}
