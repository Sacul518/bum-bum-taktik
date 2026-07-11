import { generateTerrain, type TerrainGenOptions, type TerrainMap } from './terrain.js';
import { connectLargestIslands } from './bridge.js';

// Map-Presets ("Regionen", docs/KONZEPT.md Abschnitt 3.1): benannte
// Parametersaetze fuer generateTerrain. Die Zahlenwerte sind per
// ASCII-Vorschau getunt (npm run preview -w @bum-bum-taktik/shared -- <preset>).

export type MapPresetId = 'wueste' | 'gebirge' | 'plains' | 'meer';

export interface MapPreset {
  id: MapPresetId;
  /** Anzeigename im Terminal. */
  name: string;
  description: string;
  width: number;
  height: number;
  gen: TerrainGenOptions;
  /** Meer-Preset: nach der Generierung die zwei groessten Inseln verbinden. */
  bridge?: boolean;
  /**
   * Start-Zoom des Clients (sichtbare Frustum-Hoehe in Kacheln) nach dem
   * Laden dieser Karte. Ohne Angabe gilt der Standard-Zoom des Clients.
   * Gedacht fuer Karten, deren Motiv sonst nicht in die Startansicht passt.
   */
  startViewSize?: number;
}

export const MAP_PRESETS: Record<MapPresetId, MapPreset> = {
  wueste: {
    id: 'wueste',
    name: 'Wueste',
    description: 'Sand dominiert, vereinzelte Oasen und Felsen.',
    width: 500,
    height: 500,
    gen: {
      seed: 1,
      // Wassergrenzen ganz tief: nur die tiefsten Noise-Taeler werden Oasen.
      thresholds: { deepWaterMax: -0.62, shallowWaterMax: -0.52, beachMax: -0.5, plainsMax: 0.5 },
      // Ebenen mit wenig Feuchtigkeit werden Sand; die restlichen gruenen
      // Flecken lesen sich als Vegetation um die Oasen.
      sandMoistureMax: 0.35,
    },
  },
  gebirge: {
    id: 'gebirge',
    name: 'Gebirge',
    description: 'Ausgepraegte Gebirgszuege, Schnee auf den Gipfeln.',
    width: 500,
    height: 500,
    gen: {
      seed: 1,
      ridged: true,
      // Wenig Wasser (Bergseen), schmale Taeler, viel Huegel/Berg-Anteil.
      thresholds: { deepWaterMax: -0.5, shallowWaterMax: -0.42, beachMax: -0.4, plainsMax: 0.0, hillsMax: 0.35 },
      snowMin: 0.62,
    },
  },
  plains: {
    id: 'plains',
    name: 'Plains',
    description: 'Gemischte Kontinente mit Ozeanen - die bisherige Standardkarte.',
    width: 500,
    height: 500,
    // Bewusst leer bis auf den Seed: exakt der bisherige Look der 500er-Karte.
    gen: { seed: 1 },
  },
  meer: {
    id: 'meer',
    name: 'Meer',
    description: 'Offenes Meer, in der Mitte zwei groessere Inseln mit Bruecke.',
    width: 500,
    height: 500,
    gen: {
      // Seed 6 liefert genau zwei Inseln im Insel-Quadrat, ohne Mini-Inseln
      // (per Seed-Scan 1-14 ausgesucht).
      seed: 6,
      // Landgrenze hoch + grobes Noise: nur die hoechsten Kuppen ragen als
      // Inseln heraus - und nur im zentralen 100x100-Quadrat (islandRegion),
      // damit die Inseln kompakt bleiben; drumherum offenes Tiefwasser.
      elevationScale: 0.01,
      thresholds: { deepWaterMax: 0.16, shallowWaterMax: 0.28, beachMax: 0.32 },
      islandRegion: { size: 100, falloff: 24 },
    },
    bridge: true,
    // Beide Inseln samt Bruecke liegen im zentralen 100x100-Quadrat - mit
    // dem Standard-Zoom (40) saehe man nach dem Kartenwechsel nur eine Insel.
    startViewSize: 130,
  },
};

export const DEFAULT_PRESET_ID: MapPresetId = 'plains';

export function isMapPresetId(value: string): value is MapPresetId {
  return value in MAP_PRESETS;
}

/** Generiert die Karte eines Presets inklusive Post-Processing (Bruecke). */
export function generatePresetMap(presetId: MapPresetId, seedOverride?: number): TerrainMap {
  const preset = MAP_PRESETS[presetId];
  const gen = seedOverride === undefined ? preset.gen : { ...preset.gen, seed: seedOverride };
  const map = generateTerrain(preset.width, preset.height, gen);
  if (preset.bridge) connectLargestIslands(map);
  return map;
}
