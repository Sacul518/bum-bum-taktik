import * as THREE from 'three';
import { BUILDINGS, type BuildingFaction, type BuildingSnapshot, type BuildingType } from '@bum-bum-taktik/shared';
import { COLOR_DARK, FACTION_PRIMARY, FACTION_SECONDARY, box, material } from './models.js';

// Prozedurale Gebaeude-Modelle (Aufgabe "Gebaeude & Basen"), gleiche Bauart
// und Farbwelt wie die Einheiten in models.ts. Gebaeude drehen sich nie -
// applyBuildingSnapshot aktualisiert nur HP- und Einnahme-Balken; bei einem
// Fraktionswechsel (Capture) baut main.ts das Mesh komplett neu.

// Neutrale Gebaeude (Staedte vor der Einnahme) in Grau statt Fraktionsfarbe.
const NEUTRAL_PRIMARY = 0x8a8a8a;
const NEUTRAL_SECONDARY = 0x6e6e6e;

function primaryColor(faction: BuildingFaction): number {
  return faction === 'neutral' ? NEUTRAL_PRIMARY : FACTION_PRIMARY[faction];
}

function secondaryColor(faction: BuildingFaction): number {
  return faction === 'neutral' ? NEUTRAL_SECONDARY : FACTION_SECONDARY[faction];
}

// Vertikaler Zylinder (Schornstein, Turmschaft) - Gegenstueck zu cylinderX
// in models.ts, das entlang +X liegt.
function cylinderY(radius: number, height: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12), material(color));
  mesh.position.set(x, y, z);
  return mesh;
}

function buildHq(faction: BuildingFaction): THREE.Group {
  const model = new THREE.Group();
  model.add(box(3, 0.9, 3, primaryColor(faction), 0, 0.45, 0)); // Bunker-Sockel
  model.add(box(2, 0.6, 2, secondaryColor(faction), 0, 1.2, 0)); // Aufbau
  model.add(cylinderY(0.05, 1.4, COLOR_DARK, 0.7, 2.2, 0.7)); // Antenne
  return model;
}

function buildFactory(faction: BuildingFaction): THREE.Group {
  const model = new THREE.Group();
  model.add(box(2.4, 1.0, 1.8, primaryColor(faction), 0, 0.5, 0)); // Halle
  model.add(box(2.4, 0.25, 0.9, secondaryColor(faction), 0, 1.12, -0.45)); // Sheddach
  model.add(cylinderY(0.18, 1.6, COLOR_DARK, 0.85, 1.3, 0.55)); // Schornstein
  return model;
}

function buildCity(faction: BuildingFaction): THREE.Group {
  const model = new THREE.Group();
  const primary = primaryColor(faction);
  const secondary = secondaryColor(faction);
  // Kleiner Haeuser-Cluster mit unterschiedlichen Hoehen.
  model.add(box(0.9, 1.4, 0.9, primary, -0.7, 0.7, -0.5));
  model.add(box(0.8, 0.9, 0.8, secondary, 0.55, 0.45, -0.55));
  model.add(box(1.0, 0.7, 1.0, primary, 0.5, 0.35, 0.6));
  model.add(box(0.7, 1.1, 0.7, secondary, -0.55, 0.55, 0.65));
  return model;
}

function buildTower(faction: BuildingFaction): THREE.Group {
  const model = new THREE.Group();
  model.add(cylinderY(0.42, 2.2, secondaryColor(faction), 0, 1.1, 0)); // Schaft
  model.add(box(1.1, 0.4, 1.1, primaryColor(faction), 0, 2.4, 0)); // Plattform
  model.add(cylinderY(0.08, 0.8, COLOR_DARK, 0, 3.0, 0)); // Flak-Lauf
  return model;
}

const BUILDERS: Record<BuildingType, (faction: BuildingFaction) => THREE.Group> = {
  hq: buildHq,
  factory: buildFactory,
  city: buildCity,
  tower: buildTower,
};

// Balken wie bei den Einheiten (units.ts): Kamera-zugewandte Sprites auf der
// Mittelachse. HP-Balken nur sichtbar, wenn das Gebaeude beschaedigt ist;
// darunter ein gelber Einnahme-Fortschrittsbalken, solange ein Capture laeuft.
const BAR_WIDTH = 1.6;
const BAR_HEIGHT = 0.16;

const barBackgroundMaterial = new THREE.SpriteMaterial({ color: 0x222222 });
const hpFillMaterial = new THREE.SpriteMaterial({ color: 0x33cc33 });
const captureFillMaterial = new THREE.SpriteMaterial({ color: 0xffcc33 });

// Balkenhoehe ueber der jeweils hoechsten Modellkante.
const BAR_Y: Record<BuildingType, number> = {
  hq: 3.2,
  factory: 2.5,
  city: 2.0,
  tower: 3.6,
};

function createBar(fillMaterial: THREE.SpriteMaterial, fillName: string, groupName: string, y: number): THREE.Group {
  const background = new THREE.Sprite(barBackgroundMaterial);
  background.scale.set(BAR_WIDTH, BAR_HEIGHT, 1);
  background.position.y = y;

  const fill = new THREE.Sprite(fillMaterial);
  fill.name = fillName;
  fill.scale.set(BAR_WIDTH, BAR_HEIGHT, 1);
  fill.position.y = y;
  fill.renderOrder = 1;

  background.raycast = () => {};
  fill.raycast = () => {};

  const bar = new THREE.Group();
  bar.name = groupName;
  bar.add(background, fill);
  bar.visible = false;
  return bar;
}

function setBarFraction(bar: THREE.Object3D, fillName: string, fraction: number): void {
  const fill = bar.getObjectByName(fillName) as THREE.Sprite | undefined;
  if (!fill) return;
  const clamped = Math.min(Math.max(fraction, 0.02), 1);
  fill.scale.x = BAR_WIDTH * clamped;
  // Linksbuendig schrumpfen, gleiche center.x-Rechnung wie updateHpBar in units.ts.
  fill.center.x = 1 / (2 * clamped);
}

export function createBuildingMesh(buildingType: BuildingType, faction: BuildingFaction): THREE.Group {
  const group = new THREE.Group();
  group.add(BUILDERS[buildingType](faction));
  group.add(createBar(hpFillMaterial, 'hpFill', 'hpBar', BAR_Y[buildingType]));
  group.add(createBar(captureFillMaterial, 'captureFill', 'captureBar', BAR_Y[buildingType] - BAR_HEIGHT * 1.6));
  return group;
}

export function applyBuildingSnapshot(group: THREE.Object3D, snapshot: BuildingSnapshot): void {
  const maxHp = BUILDINGS[snapshot.buildingType].maxHp;
  const hpBar = group.getObjectByName('hpBar');
  if (hpBar) {
    hpBar.visible = snapshot.hp < maxHp;
    setBarFraction(hpBar, 'hpFill', snapshot.hp / maxHp);
  }

  const captureBar = group.getObjectByName('captureBar');
  if (captureBar) {
    const progress = snapshot.captureProgress ?? 0;
    captureBar.visible = progress > 0;
    setBarFraction(captureBar, 'captureFill', progress);
  }
}
