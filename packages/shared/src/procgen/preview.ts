import { generateTerrain, TERRAIN_TYPES, type TerrainMap, type TerrainType } from './terrain.js';
import { computeWalkability } from './walkability.js';
import { generatePresetMap, isMapPresetId, MAP_PRESETS } from './presets.js';

// Handbetriebenes Werkzeug zum Ansehen/Balancing der Terrain-Generierung
// (docs/KONZEPT.md Abschnitt 8.1, Subagent E). Aufrufe:
//   npm run preview -w @bum-bum-taktik/shared -- <width> <height> [seed]
//   npm run preview -w @bum-bum-taktik/shared -- <preset> [seed]

const SYMBOLS: Record<TerrainType, string> = {
  deepWater: '~',
  shallowWater: '.',
  beach: ',',
  plains: '"',
  hills: '^',
  mountains: '#',
  sand: ':',
  snow: '*',
  bridge: '=',
};

// Karten breiter als das hier werden fuers Terminal heruntergerechnet (jede
// n-te Kachel gezeigt) - die Verteilung unten zaehlt trotzdem alle Kacheln.
const MAX_PREVIEW_COLUMNS = 120;

const args = process.argv.slice(2);

let map: TerrainMap;
if (args[0] && isMapPresetId(args[0])) {
  const seedOverride = args[1] ? Number(args[1]) : undefined;
  map = generatePresetMap(args[0], seedOverride);
  const preset = MAP_PRESETS[args[0]];
  console.log(`Preset "${preset.name}" (${preset.width}x${preset.height}, Seed ${seedOverride ?? preset.gen.seed ?? 1})`);
} else {
  const width = args[0] ? Number(args[0]) : 100;
  const height = args[1] ? Number(args[1]) : 50;
  const seed = args[2] ? Number(args[2]) : 1;
  map = generateTerrain(width, height, { seed });
}

const step = Math.max(1, Math.ceil(map.width / MAX_PREVIEW_COLUMNS));
if (step > 1) {
  console.log(`(Vorschau zeigt jede ${step}. Kachel)`);
}

const counts = new Map<TerrainType, number>();
for (let i = 0; i < map.terrain.length; i++) {
  const type = TERRAIN_TYPES[map.terrain[i] as number] as TerrainType;
  counts.set(type, (counts.get(type) ?? 0) + 1);
}

const lines: string[] = [];
for (let y = 0; y < map.height; y += step) {
  let line = '';
  for (let x = 0; x < map.width; x += step) {
    const type = TERRAIN_TYPES[map.terrain[y * map.width + x] as number] as TerrainType;
    line += SYMBOLS[type];
  }
  lines.push(line);
}

console.log(lines.join('\n'));
console.log('\nLegende: ' + TERRAIN_TYPES.map((t) => `${SYMBOLS[t]}=${t}`).join('  '));

const total = map.width * map.height;
console.log('\nVerteilung:');
for (const type of TERRAIN_TYPES) {
  const count = counts.get(type) ?? 0;
  console.log(`  ${type.padEnd(12)} ${((count / total) * 100).toFixed(1)}%`);
}

// Begehbarkeits-Raster (docs/KONZEPT.md Abschnitt 3): Land- und Wasser-Domain
// visuell gegen die Terrain-Karte oben pruefen - Kuestenlinie sollte exakt
// dort umschlagen, wo die beiden Raster sich abloesen. Luft ist aktuell
// ueberall begehbar und daher nicht separat abgebildet.
const walkability = computeWalkability(map);

function printWalkabilityGrid(grid: Uint8Array, walkableChar: string): void {
  const gridLines: string[] = [];
  for (let y = 0; y < map.height; y += step) {
    let line = '';
    for (let x = 0; x < map.width; x += step) {
      line += grid[y * map.width + x] ? walkableChar : ' ';
    }
    gridLines.push(line);
  }
  console.log(gridLines.join('\n'));
}

console.log('\nBegehbarkeits-Raster Land (X = begehbar):');
printWalkabilityGrid(walkability.land, 'X');

console.log('\nBegehbarkeits-Raster Wasser (O = befahrbar):');
printWalkabilityGrid(walkability.water, 'O');
