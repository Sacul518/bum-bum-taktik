import { terrainIndex, type TerrainMap } from './terrain.js';

// Post-Processing fuer das Meer-Preset (docs/KONZEPT.md Abschnitt 3.1):
// verbindet die zwei groessten Inseln einer fertig generierten Karte mit
// einer geraden, 2 Kacheln breiten Bruecke. Rein deterministisch - gleicher
// Seed ergibt dieselbe Bruecke.

const BRIDGE_INDEX = terrainIndex('bridge');
const DEEP_WATER_INDEX = terrainIndex('deepWater');
const SHALLOW_WATER_INDEX = terrainIndex('shallowWater');

// Deck-Hoehe knapp ueber dem Meeresspiegel (shallowWaterMax der Standard-
// Schwellenwerte ist 0.0): Landeinheiten stehen sichtbar ueber dem Wasser.
const BRIDGE_DECK_ELEVATION = 0.05;

function isLandTile(terrain: Uint8Array, i: number): boolean {
  const type = terrain[i] as number;
  return type !== DEEP_WATER_INDEX && type !== SHALLOW_WATER_INDEX;
}

interface Island {
  /** Kachel-Indizes (row-major) der Insel. */
  tiles: number[];
}

// Flood-Fill (4er-Nachbarschaft) ueber alle Landkacheln: jede
// zusammenhaengende Landmasse wird eine Insel.
function findIslands(map: TerrainMap): Island[] {
  const { width, height, terrain } = map;
  const visited = new Uint8Array(width * height);
  const islands: Island[] = [];

  for (let start = 0; start < terrain.length; start++) {
    if (visited[start] || !isLandTile(terrain, start)) continue;

    const tiles: number[] = [];
    const queue = [start];
    visited[start] = 1;

    while (queue.length > 0) {
      const i = queue.pop() as number;
      tiles.push(i);
      const x = i % width;
      const y = (i - x) / width;

      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!visited[ni] && isLandTile(terrain, ni)) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    islands.push({ tiles });
  }

  return islands;
}

// Nur Kuestenkacheln (Land mit mindestens einem Wasser-Nachbarn) - haelt die
// Suche nach dem naechstgelegenen Kachelpaar klein.
function coastlineOf(island: Island, map: TerrainMap): number[] {
  const { width, height, terrain } = map;
  return island.tiles.filter((i) => {
    const x = i % width;
    const y = (i - x) / width;
    return (
      (x > 0 && !isLandTile(terrain, i - 1)) ||
      (x < width - 1 && !isLandTile(terrain, i + 1)) ||
      (y > 0 && !isLandTile(terrain, i - width)) ||
      (y < height - 1 && !isLandTile(terrain, i + width))
    );
  });
}

function closestPair(coastA: number[], coastB: number[], width: number): { a: number; b: number } {
  let best = { a: coastA[0] as number, b: coastB[0] as number };
  let bestDistance = Infinity;

  for (const a of coastA) {
    const ax = a % width;
    const ay = (a - ax) / width;
    for (const b of coastB) {
      const bx = b % width;
      const by = (b - bx) / width;
      const distance = (ax - bx) ** 2 + (ay - by) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { a, b };
      }
    }
  }

  return best;
}

/**
 * Verbindet die zwei groessten Inseln der Karte mit einer geraden Bruecke
 * (Terrain-Typ "bridge", 2 Kacheln breit). Existiert nur eine Insel (oder
 * gar keine), bleibt die Karte unveraendert.
 */
export function connectLargestIslands(map: TerrainMap): void {
  const islands = findIslands(map).sort((a, b) => b.tiles.length - a.tiles.length);
  if (islands.length < 2) return;

  const { width, terrain, elevation } = map;
  const first = islands[0] as Island;
  const second = islands[1] as Island;
  const { a, b } = closestPair(coastlineOf(first, map), coastlineOf(second, map), width);

  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;

  // Gerade Linie zwischen beiden Kuestenpunkten, pro Schritt eine Kachel
  // entlang der dominanten Achse (einfacher Bresenham-Ersatz). Die zweite
  // Spurbreite liegt quer zur dominanten Richtung.
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);

  for (let step = 0; step <= steps; step++) {
    const t = steps === 0 ? 0 : step / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    const sideTile = horizontal ? { x, y: y + 1 } : { x: x + 1, y };

    for (const tile of [{ x, y }, sideTile]) {
      if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= map.height) continue;
      const i = tile.y * width + tile.x;
      // Nur Wasser wird zur Bruecke - die Landenden der Inseln bleiben Land.
      if (isLandTile(terrain, i)) continue;
      terrain[i] = BRIDGE_INDEX;
      elevation[i] = BRIDGE_DECK_ELEVATION;
    }
  }
}
