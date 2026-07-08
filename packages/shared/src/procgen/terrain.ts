import { createNoise2D } from 'simplex-noise';
import { ELEVATION_THRESHOLDS } from '../constants.js';

// Reihenfolge ist der Index, der in TerrainMap.terrain gespeichert wird -
// siehe docs/KONZEPT.md Abschnitt 3 fuer die Bedeutung der Stufen.
export const TERRAIN_TYPES = [
  'deepWater',
  'shallowWater',
  'beach',
  'plains',
  'hills',
  'mountains',
] as const;

export type TerrainType = (typeof TERRAIN_TYPES)[number];

export interface TerrainMap {
  width: number;
  height: number;
  /** Hoehenwert e in [-1, 1] pro Kachel, row-major (Index = y * width + x). */
  elevation: Float32Array;
  /** Feuchtigkeitswert in [-1, 1] pro Kachel, aktuell nur fuer spaetere Einfaerbung/Biome. */
  moisture: Float32Array;
  /** Index in TERRAIN_TYPES pro Kachel. */
  terrain: Uint8Array;
}

export interface TerrainGenOptions {
  seed?: number;
  elevationOctaves?: number;
  moistureOctaves?: number;
  /** Groesser = kleinteiligeres Rauschen (mehr, kleinere Inseln). */
  elevationScale?: number;
  moistureScale?: number;
}

// Deterministischer PRNG (mulberry32), damit derselbe Seed immer dieselbe
// Karte ergibt - simplex-noise akzeptiert nur eine Zufallsfunktion, kein
// Zahlen-Seed direkt.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fractal Brownian Motion: mehrere Oktaven von Simplex-Noise uebereinander -
// grobe Oktave fuer Landmassen, feinere fuer Detailrauschen (KONZEPT Abschnitt 3).
function fractalNoise2D(
  noise2D: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxAmplitude;
}

function classifyElevation(elevation: number): number {
  const t = ELEVATION_THRESHOLDS;
  if (elevation < t.deepWaterMax) return 0; // deepWater
  if (elevation < t.shallowWaterMax) return 1; // shallowWater
  if (elevation < t.beachMax) return 2; // beach
  if (elevation < t.plainsMax) return 3; // plains
  if (elevation < t.hillsMax) return 4; // hills
  return 5; // mountains
}

export function generateTerrain(width: number, height: number, options: TerrainGenOptions = {}): TerrainMap {
  const {
    seed = 1,
    elevationOctaves = 5,
    moistureOctaves = 3,
    elevationScale = 0.01,
    moistureScale = 0.02,
  } = options;

  const elevationNoise = createNoise2D(mulberry32(seed));
  const moistureNoise = createNoise2D(mulberry32(seed + 1));

  const elevation = new Float32Array(width * height);
  const moisture = new Float32Array(width * height);
  const terrain = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = fractalNoise2D(elevationNoise, x * elevationScale, y * elevationScale, elevationOctaves, 0.5, 2);
      const m = fractalNoise2D(moistureNoise, x * moistureScale, y * moistureScale, moistureOctaves, 0.5, 2);
      elevation[i] = e;
      moisture[i] = m;
      terrain[i] = classifyElevation(e);
    }
  }

  return { width, height, elevation, moisture, terrain };
}
