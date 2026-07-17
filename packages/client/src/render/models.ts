import * as THREE from 'three';
import type { Faction, UnitType } from '@bum-bum-taktik/shared';
import { applyFogDarkening } from './fog.js';

// Prozedurale Low-Poly-3D-Modelle fuer alle Einheitentypen (Aufgabe
// "3D-Modelle & Waffen-System"): aus Three.js-Primitiven zusammengesetzt
// statt aus glTF-Dateien - kein Loader, kein Asset-Download, volle Kontrolle
// ueber die Fraktionsfarben. Alle Modelle zeigen mit der Fahrtrichtung nach
// +X (heading 0), wie zuvor die Sprites; gedreht wird die ganze Gruppe in
// applySnapshot() (units.ts). MeshLambertMaterial braucht Licht - die
// Lichtquellen stehen in scene.ts.

// Hoehe der Modell-Unterkante ueber der Kacheloberflaeche: Bodeneinheiten
// minimal angehoben (gegen Z-Fighting mit Auswahlring/Terrain), Flugzeuge
// schweben sichtbar darueber, damit sie auch ueber Bergen erkennbar bleiben.
export const UNIT_Y_OFFSET: Record<UnitType, number> = {
  tank: 0.02,
  infantry: 0.02,
  boat: 0.02,
  plane: 3,
};

// Zwei Rumpffarben pro Fraktion (Primaer = Rumpf, Sekundaer = Aufbauten),
// dazu fraktionsneutrale Farben fuer Ketten/Laeufe/Kanzeln. Exportiert,
// weil die Gebaeude-Modelle (buildings.ts) dieselbe Farbwelt nutzen.
export const FACTION_PRIMARY: Record<Faction, number> = {
  player: 0x5f7f3f, // Olivgruen
  enemy: 0x9e3b32, // Rostrot
};
export const FACTION_SECONDARY: Record<Faction, number> = {
  player: 0x46602e,
  enemy: 0x772b23,
};
export const COLOR_DARK = 0x2e2e2e; // Ketten, Rohre, Reifen
const COLOR_GLASS = 0x9fd4e8; // Cockpit-Kanzel

// Materialien werden pro Farbe gecacht und von allen Einheiten geteilt -
// ein Modell besteht aus mehreren Meshes, aber es entstehen nur eine Handvoll
// Materialien insgesamt.
const materialCache = new Map<number, THREE.MeshLambertMaterial>();

export function material(color: number): THREE.MeshLambertMaterial {
  let cached = materialCache.get(color);
  if (!cached) {
    cached = new THREE.MeshLambertMaterial({ color });
    // Der Server schickt ALLE Gebaeude, auch die im Fog of War - die
    // Verdunkelung muss deshalb auch auf den Modell-Materialien sitzen
    // (render/fog.ts). Einheiten trifft das nie sichtbar: die stehen immer
    // im eigenen Sichtkreis bzw. werden nur geschickt, wenn sichtbar.
    applyFogDarkening(cached);
    materialCache.set(color, cached);
  }
  return cached;
}

export function box(width: number, height: number, depth: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
  mesh.position.set(x, y, z);
  return mesh;
}

// Zylinder, dessen Achse entlang +X liegt (Kanonenrohre, Flugzeugrumpf).
function cylinderX(radius: number, length: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material(color));
  mesh.rotation.z = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

// Kegel mit Spitze in +X-Richtung (Bug, Flugzeugnase).
function coneX(radius: number, length: number, segments: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, length, segments), material(color));
  mesh.rotation.z = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

function buildTank(faction: Faction): THREE.Group {
  const model = new THREE.Group();
  const primary = FACTION_PRIMARY[faction];
  const secondary = FACTION_SECONDARY[faction];

  model.add(box(1.25, 0.28, 0.32, COLOR_DARK, 0, 0.14, 0.36)); // Kette rechts
  model.add(box(1.25, 0.28, 0.32, COLOR_DARK, 0, 0.14, -0.36)); // Kette links
  model.add(box(1.15, 0.32, 0.72, primary, 0, 0.44, 0)); // Wanne
  model.add(box(0.62, 0.26, 0.5, secondary, -0.05, 0.73, 0)); // Turm
  model.add(cylinderX(0.055, 0.75, COLOR_DARK, 0.55, 0.75, 0)); // Rohr
  return model;
}

function buildInfantry(faction: Faction): THREE.Group {
  const model = new THREE.Group();

  model.add(box(0.16, 0.24, 0.12, COLOR_DARK, 0.06, 0.12, 0.08)); // Bein
  model.add(box(0.16, 0.24, 0.12, COLOR_DARK, 0.06, 0.12, -0.08)); // Bein
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.42, 10), material(FACTION_PRIMARY[faction]));
  torso.position.set(0, 0.45, 0);
  model.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), material(FACTION_SECONDARY[faction]));
  helmet.position.set(0, 0.74, 0);
  model.add(helmet);
  model.add(box(0.44, 0.055, 0.055, COLOR_DARK, 0.22, 0.52, 0.1)); // Gewehr
  return model;
}

function buildBoat(faction: Faction): THREE.Group {
  const model = new THREE.Group();
  const primary = FACTION_PRIMARY[faction];
  const secondary = FACTION_SECONDARY[faction];

  model.add(box(1.7, 0.3, 0.62, primary, 0, 0.16, 0)); // Rumpf
  model.add(coneX(0.3, 0.45, 4, primary, 1.07, 0.16, 0)); // Bug-Keil
  model.add(box(0.5, 0.34, 0.42, secondary, -0.2, 0.48, 0)); // Bruecke
  model.add(box(0.3, 0.2, 0.3, secondary, 0.45, 0.41, 0)); // Geschuetzsockel
  model.add(cylinderX(0.04, 0.55, COLOR_DARK, 0.75, 0.47, 0)); // Geschuetzrohr
  return model;
}

function buildPlane(faction: Faction): THREE.Group {
  const model = new THREE.Group();
  const primary = FACTION_PRIMARY[faction];
  const secondary = FACTION_SECONDARY[faction];

  model.add(cylinderX(0.16, 1.2, primary, 0, 0, 0)); // Rumpf
  model.add(coneX(0.16, 0.32, 10, secondary, 0.76, 0, 0)); // Nase
  model.add(box(0.42, 0.06, 1.55, secondary, 0.08, 0, 0)); // Tragflaechen
  model.add(box(0.28, 0.05, 0.6, secondary, -0.52, 0.05, 0)); // Hoehenleitwerk
  model.add(box(0.28, 0.3, 0.05, secondary, -0.52, 0.18, 0)); // Seitenleitwerk
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), material(COLOR_GLASS));
  canopy.scale.set(1.6, 0.9, 1);
  canopy.position.set(0.25, 0.13, 0);
  model.add(canopy);
  return model;
}

const BUILDERS: Record<UnitType, (faction: Faction) => THREE.Group> = {
  tank: buildTank,
  infantry: buildInfantry,
  boat: buildBoat,
  plane: buildPlane,
};

/**
 * Baut das 3D-Modell eines Einheitentyps (Fahrtrichtung +X, Unterkante bei
 * y=UNIT_Y_OFFSET). Geometrien sind pro Aufruf neu, Materialien geteilt -
 * bei den aktuellen Einheitenzahlen (Dutzende) voellig unkritisch.
 */
export function createUnitModel(unitType: UnitType, faction: Faction): THREE.Group {
  const model = BUILDERS[unitType](faction);
  model.position.y = UNIT_Y_OFFSET[unitType];
  return model;
}
