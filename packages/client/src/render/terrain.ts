import * as THREE from 'three';
import { TERRAIN_TYPES, type TerrainType } from '@bum-bum-taktik/shared';

// Platzhalter-Farben pro Terrain-Typ (docs/KONZEPT.md Abschnitt 3). Echte
// Sprite-/Textur-Darstellung folgt spaeter in Phase 1 (Asset-Pipeline).
const TERRAIN_COLORS: Record<TerrainType, THREE.Color> = {
  deepWater: new THREE.Color(0x1c4966),
  shallowWater: new THREE.Color(0x3d84a8),
  beach: new THREE.Color(0xe3d9a6),
  plains: new THREE.Color(0x4f7942),
  hills: new THREE.Color(0x7c6a46),
  mountains: new THREE.Color(0x9a9a9a),
};

// Elevation (-1..1) auf Welteinheiten skaliert, damit Huegel/Berge sichtbar
// aufragen und Wasser sichtbar tiefer liegt.
export const HEIGHT_SCALE = 6;
// Tiefer als jede moegliche Kachelhoehe (min. -1 * HEIGHT_SCALE), damit die
// Seitenwaende jeder Kachel garantiert bis unter die tiefste Nachbarkachel
// reichen - sonst entstehen Luecken zwischen unterschiedlich hohen Nachbarn.
const FLOOR_Y = -HEIGHT_SCALE - 4;
// Seitenwaende etwas dunkler als die Oberseite - billiger Ersatz fuer
// echte Beleuchtung, hilft aber schon, Hoehe und Tiefe zu erkennen.
const SIDE_SHADE = 0.6;

type Vec3 = [number, number, number];

// Server-Koordinaten (0..width, 0..height) sind Kachel-Indizes; die Welt hat
// ihren Ursprung in der Kartenmitte (wie applySnapshot() in units.ts), darum
// hier derselbe Versatz.
export function createTerrainMesh(
  width: number,
  height: number,
  terrainTypes: Uint8Array,
  elevation: Float32Array,
): THREE.Mesh {
  const tileCount = width * height;
  // 5 Flaechen pro Kachel (Oberseite + 4 Seitenwaende), 6 Vertices pro Flaeche.
  const vertexCapacity = tileCount * 5 * 6;
  const positions = new Float32Array(vertexCapacity * 3);
  const colors = new Float32Array(vertexCapacity * 3);

  const offsetX = width / 2;
  const offsetZ = height / 2;
  let vertexIndex = 0;

  function pushVertex(x: number, y: number, z: number, color: THREE.Color): void {
    const base = vertexIndex * 3;
    positions[base] = x;
    positions[base + 1] = y;
    positions[base + 2] = z;
    colors[base] = color.r;
    colors[base + 1] = color.g;
    colors[base + 2] = color.b;
    vertexIndex += 1;
  }

  function pushQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: THREE.Color): void {
    pushVertex(...a, color);
    pushVertex(...b, color);
    pushVertex(...c, color);
    pushVertex(...a, color);
    pushVertex(...c, color);
    pushVertex(...d, color);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const type = TERRAIN_TYPES[terrainTypes[i] as number] as TerrainType;
      const color = TERRAIN_COLORS[type];
      const sideColor = color.clone().multiplyScalar(SIDE_SHADE);
      const topY = (elevation[i] as number) * HEIGHT_SCALE;

      const x0 = x - offsetX;
      const x1 = x0 + 1;
      const z0 = y - offsetZ;
      const z1 = z0 + 1;

      // Oberseite - Kanten zwischen Kacheln bleiben scharf, weil jede Kachel
      // ihre eigenen (nicht geteilten) Vertices bekommt statt sie mit
      // Nachbarn zu teilen.
      pushQuad([x0, topY, z0], [x0, topY, z1], [x1, topY, z1], [x1, topY, z0], color);

      // Seitenwaende bis zum Boden, damit keine Luecken zu tieferen
      // Nachbarkacheln entstehen (Material ist DoubleSide, Wickelrichtung
      // der Vierecke ist daher nicht sicherheitskritisch).
      pushQuad([x0, topY, z0], [x0, topY, z1], [x0, FLOOR_Y, z1], [x0, FLOOR_Y, z0], sideColor);
      pushQuad([x1, topY, z1], [x1, topY, z0], [x1, FLOOR_Y, z0], [x1, FLOOR_Y, z1], sideColor);
      pushQuad([x1, topY, z0], [x0, topY, z0], [x0, FLOOR_Y, z0], [x1, FLOOR_Y, z0], sideColor);
      pushQuad([x0, topY, z1], [x1, topY, z1], [x1, FLOOR_Y, z1], [x0, FLOOR_Y, z1], sideColor);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

// Gleiche Koordinatenumrechnung wie oben (Weltursprung = Kartenmitte), damit
// Einheiten in units.ts auf der tatsaechlichen Kachelhoehe stehen statt immer
// auf y=0 - sonst sinken sie in Huegeln ein bzw. schweben ueber Wasser.
export function sampleElevation(worldX: number, worldZ: number, width: number, height: number, elevation: Float32Array): number {
  const gx = Math.min(Math.max(Math.floor(worldX + width / 2), 0), width - 1);
  const gz = Math.min(Math.max(Math.floor(worldZ + height / 2), 0), height - 1);
  return (elevation[gz * width + gx] as number) * HEIGHT_SCALE;
}
