import * as THREE from 'three';
import { TERRAIN_TYPES, type TerrainType } from '@bum-bum-taktik/shared';
import { HEIGHT_SCALE } from './terrain.js';
import { material } from './models.js';

// Karten-Deko (PLAN.md Session B): Baeume auf Ebenen, Felsen auf Huegeln/
// Bergen/Sand - rein visuell, ohne Einfluss auf Begehbarkeit oder Server.
// Instanced Meshes wegen des iPad-GPU-Budgets (KONZEPT Abschnitt 4): alle
// Baeume zusammen sind nur zwei Draw-Calls (Stamm + Krone), alle Felsen
// einer. Die Materialien kommen aus dem geteilten Cache in models.ts und
// tragen damit automatisch die Fog-of-War-Verdunkelung.

// Dichte pro Terrain-Typ (Wahrscheinlichkeit pro Kachel). Werte klein
// halten: eine 500x500-Karte hat 250k Kacheln.
const TREE_DENSITY: Partial<Record<TerrainType, number>> = {
  plains: 0.05,
  hills: 0.015,
};
const ROCK_DENSITY: Partial<Record<TerrainType, number>> = {
  hills: 0.02,
  mountains: 0.035,
  sand: 0.008,
};

// Harte Obergrenzen (iPad-GPU): mehr Instanzen werden gleichmaessig
// ausgeduennt statt abgeschnitten (sonst waere eine Kartenecke kahl).
const TREE_CAP = 4000;
const ROCK_CAP = 2000;

// Kein Deko-Objekt naeher als so viele Kacheln an einem Gebaeude - die
// Modelle sind mehrere Kacheln gross, Baeume stuenden sonst im Haus.
const BUILDING_CLEARANCE = 3.5;

// Deterministischer Hash pro Kachel (statt Math.random): dieselbe Karte
// sieht bei jedem Client und jedem Neuladen gleich aus.
function hash2D(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface DecoSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

function buildInstancedMesh(geometry: THREE.BufferGeometry, color: number, spots: DecoSpot[], scaleY = 1): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material(color), spots.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  spots.forEach((spot, index) => {
    position.set(spot.x, spot.y, spot.z);
    rotation.setFromAxisAngle(axisY, spot.rotation);
    scale.set(spot.scale, spot.scale * scaleY, spot.scale);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  // Deko ist statisch - Matrizen werden nie wieder angefasst.
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  // Klicks sollen durch die Deko hindurchgehen (Auswahl/Bewegung).
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Baut die komplette Karten-Deko als Gruppe (2 Draw-Calls Baeume, 1 Felsen).
 * buildings: Weltpositionen, die freigehalten werden (erst mit dem ersten
 * StateUpdate bekannt - main.ts ruft deshalb erst dann auf).
 */
export function createDecoration(
  mapWidth: number,
  mapHeight: number,
  terrainTypes: Uint8Array,
  elevation: Float32Array,
  buildings: ReadonlyArray<{ x: number; y: number }>,
): THREE.Group {
  const treeSpots: DecoSpot[] = [];
  const rockSpots: DecoSpot[] = [];

  const isNearBuilding = (worldX: number, worldZ: number): boolean =>
    buildings.some((building) => Math.hypot(worldX - building.x, worldZ - building.y) < BUILDING_CLEARANCE);

  for (let ty = 0; ty < mapHeight; ty++) {
    for (let tx = 0; tx < mapWidth; tx++) {
      const type = TERRAIN_TYPES[terrainTypes[ty * mapWidth + tx] as number] as TerrainType;
      const treeDensity = TREE_DENSITY[type] ?? 0;
      const rockDensity = ROCK_DENSITY[type] ?? 0;
      if (treeDensity === 0 && rockDensity === 0) continue;

      const roll = hash2D(tx, ty, 1);
      const isTree = roll < treeDensity;
      const isRock = !isTree && roll < treeDensity + rockDensity;
      if (!isTree && !isRock) continue;

      // Position mit Jitter innerhalb der Kachel (Weltursprung = Kartenmitte,
      // gleiche Umrechnung wie render/terrain.ts).
      const worldX = tx - mapWidth / 2 + 0.5 + (hash2D(tx, ty, 2) - 0.5) * 0.7;
      const worldZ = ty - mapHeight / 2 + 0.5 + (hash2D(tx, ty, 3) - 0.5) * 0.7;
      if (isNearBuilding(worldX, worldZ)) continue;

      (isTree ? treeSpots : rockSpots).push({
        x: worldX,
        y: (elevation[ty * mapWidth + tx] as number) * HEIGHT_SCALE,
        z: worldZ,
        scale: 0.7 + hash2D(tx, ty, 4) * 0.6,
        rotation: hash2D(tx, ty, 5) * Math.PI * 2,
      });
    }
  }

  // Gleichmaessig ausduennen, falls ueber dem Cap.
  const thin = (spots: DecoSpot[], cap: number): DecoSpot[] => {
    if (spots.length <= cap) return spots;
    const step = spots.length / cap;
    const thinned: DecoSpot[] = [];
    for (let i = 0; i < cap; i++) thinned.push(spots[Math.floor(i * step)] as DecoSpot);
    return thinned;
  };
  const trees = thin(treeSpots, TREE_CAP);
  const rocks = thin(rockSpots, ROCK_CAP);

  const group = new THREE.Group();

  // Baumgeometrie mit eingebautem Hoehenversatz, damit eine Instanz-Matrix
  // fuer Stamm UND Krone reicht.
  const trunkGeometry = new THREE.CylinderGeometry(0.09, 0.13, 0.5, 5);
  trunkGeometry.translate(0, 0.25, 0);
  const crownGeometry = new THREE.ConeGeometry(0.45, 1.1, 6);
  crownGeometry.translate(0, 1.0, 0);
  group.add(buildInstancedMesh(trunkGeometry, 0x5a4630, trees));
  group.add(buildInstancedMesh(crownGeometry, 0x2e5d2e, trees));

  const rockGeometry = new THREE.DodecahedronGeometry(0.35, 0);
  rockGeometry.translate(0, 0.18, 0);
  // Felsen leicht plattgedrueckt, damit sie wie Brocken statt Baelle wirken.
  group.add(buildInstancedMesh(rockGeometry, 0x7d7d7d, rocks, 0.7));

  return group;
}

/** Entsorgt die Deko-Geometrien (Materialien sind geteilt und bleiben). */
export function disposeDecoration(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.InstancedMesh) {
      child.geometry.dispose();
      child.dispose();
    }
  }
}
