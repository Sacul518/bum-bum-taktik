import { createNoise2D } from 'simplex-noise';
import { ELEVATION_THRESHOLDS } from '../constants.js';

// Reihenfolge ist der Index, der in TerrainMap.terrain gespeichert wird -
// siehe docs/KONZEPT.md Abschnitt 3 fuer die Bedeutung der Stufen. Neue Typen
// nur hinten anhaengen, sonst verschieben sich die Indizes bereits
// verschickter Karten.
export const TERRAIN_TYPES = [
  'deepWater',
  'shallowWater',
  'beach',
  'plains',
  'hills',
  'mountains',
  'sand', // Wueste: trockene Ebene (sandMoistureMax)
  'snow', // Gebirge: Kacheln oberhalb der Schneegrenze (snowMin)
  'bridge', // Meer: per Post-Processing gesetzte Bruecke (bridge.ts)
] as const;

export type TerrainType = (typeof TERRAIN_TYPES)[number];

export function terrainIndex(type: TerrainType): number {
  return TERRAIN_TYPES.indexOf(type);
}

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

// ELEVATION_THRESHOLDS ist "as const" (Literal-Typen wie -0.2) - fuer
// Preset-Overrides muss jeder Wert aber eine beliebige Zahl sein duerfen.
export type ElevationThresholds = { [K in keyof typeof ELEVATION_THRESHOLDS]: number };

export interface TerrainGenOptions {
  seed?: number;
  elevationOctaves?: number;
  moistureOctaves?: number;
  /** Groesser = kleinteiligeres Rauschen (mehr, kleinere Inseln). */
  elevationScale?: number;
  moistureScale?: number;
  /** Abweichende Hoehen-Schwellenwerte pro Preset; fehlende Werte = Default. */
  thresholds?: Partial<ElevationThresholds>;
  /** Ebenen-Kacheln mit Feuchtigkeit unterhalb werden zu Sand (Wueste). */
  sandMoistureMax?: number;
  /** Kacheln mit Hoehe ab diesem Wert werden zu Schnee (Gebirge). */
  snowMin?: number;
  /** Ridged-Noise fuer die Hoehe: markante Bergkaemme statt runder Huegel. */
  ridged?: boolean;
  /**
   * Land entsteht nur im zentralen Quadrat dieser Kantenlaenge; ausserhalb
   * sinkt der Meeresboden ueber "falloff" Kacheln sanft auf Tiefwasser ab
   * (Meer-Preset: grosse Karte, aber kompakte Inselgruppe in der Mitte).
   */
  islandRegion?: { size: number; falloff: number };
}

// Ziel-Hoehe ausserhalb der islandRegion: sicher unter jeder deepWaterMax-
// Schwelle, damit dort nie Land entsteht.
const OCEAN_FLOOR_ELEVATION = -0.5;

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
  ridged = false,
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    const sample = noise2D(x * frequency, y * frequency);
    // Ridged: den Betrag spiegeln (1 - |n|), dann zurueck auf [-1, 1].
    // Die Spitze des Kamms liegt dort, wo das Noise durch 0 geht - das
    // erzeugt scharfe, zusammenhaengende Grate statt runder Kuppen.
    const value = ridged ? (1 - Math.abs(sample)) * 2 - 1 : sample;
    total += value * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxAmplitude;
}

function classifyTile(elevation: number, moisture: number, t: ElevationThresholds, sandMoistureMax: number | undefined, snowMin: number | undefined): number {
  if (elevation < t.deepWaterMax) return 0; // deepWater
  if (elevation < t.shallowWaterMax) return 1; // shallowWater
  if (snowMin !== undefined && elevation >= snowMin) return 7; // snow
  if (elevation < t.beachMax) return 2; // beach
  if (elevation < t.plainsMax) {
    return sandMoistureMax !== undefined && moisture < sandMoistureMax ? 6 /* sand */ : 3; // plains
  }
  if (elevation < t.hillsMax) return 4; // hills
  return 5; // mountains
}

export function generateTerrain(width: number, height: number, options: TerrainGenOptions = {}): TerrainMap {
  // elevationScale 0.0035 ist auf die 500x500-Karte abgestimmt: liefert
  // wenige grosse Kontinente und zusammenhaengende Ozeane statt vieler
  // kleiner Inseln (getunt per Downsample-Vorschau, Seed 1: ~52% Land).
  const {
    seed = 1,
    elevationOctaves = 5,
    moistureOctaves = 3,
    elevationScale = 0.0035,
    moistureScale = 0.02,
    sandMoistureMax,
    snowMin,
    ridged = false,
    islandRegion,
  } = options;
  const thresholds = { ...ELEVATION_THRESHOLDS, ...options.thresholds };

  // Grenzen des zentralen Insel-Quadrats (inklusive); Chebyshev-Abstand dazu
  // steuert unten das Absenken auf den Ozeanboden.
  const regionMinX = islandRegion ? Math.floor((width - islandRegion.size) / 2) : 0;
  const regionMaxX = islandRegion ? regionMinX + islandRegion.size - 1 : 0;
  const regionMinY = islandRegion ? Math.floor((height - islandRegion.size) / 2) : 0;
  const regionMaxY = islandRegion ? regionMinY + islandRegion.size - 1 : 0;

  const elevationNoise = createNoise2D(mulberry32(seed));
  const moistureNoise = createNoise2D(mulberry32(seed + 1));

  const elevation = new Float32Array(width * height);
  const moisture = new Float32Array(width * height);
  const terrain = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let e = fractalNoise2D(elevationNoise, x * elevationScale, y * elevationScale, elevationOctaves, 0.5, 2, ridged);
      const m = fractalNoise2D(moistureNoise, x * moistureScale, y * moistureScale, moistureOctaves, 0.5, 2);

      if (islandRegion) {
        const outside = Math.max(regionMinX - x, x - regionMaxX, regionMinY - y, y - regionMaxY, 0);
        if (outside > 0) {
          const t = Math.min(outside / islandRegion.falloff, 1);
          e += (OCEAN_FLOOR_ELEVATION - e) * t;
        }
      }

      elevation[i] = e;
      moisture[i] = m;
      terrain[i] = classifyTile(e, m, thresholds, sandMoistureMax, snowMin);
    }
  }

  return { width, height, elevation, moisture, terrain };
}
