import { generateTerrain, TERRAIN_TYPES, type TerrainType } from './terrain.js';

// Handbetriebenes Werkzeug zum Ansehen/Balancing der Terrain-Generierung
// (docs/KONZEPT.md Abschnitt 8.1, Subagent E). Aufruf: npm run preview -w @bum-bum-taktik/shared
// Optional: -- <width> <height> <seed>

const SYMBOLS: Record<TerrainType, string> = {
  deepWater: '~',
  shallowWater: '.',
  beach: ',',
  plains: '"',
  hills: '^',
  mountains: '#',
};

const [widthArg, heightArg, seedArg] = process.argv.slice(2);
const width = widthArg ? Number(widthArg) : 100;
const height = heightArg ? Number(heightArg) : 50;
const seed = seedArg ? Number(seedArg) : 1;

const map = generateTerrain(width, height, { seed });

const counts = new Map<TerrainType, number>();
const lines: string[] = [];

for (let y = 0; y < map.height; y++) {
  let line = '';
  for (let x = 0; x < map.width; x++) {
    const type = TERRAIN_TYPES[map.terrain[y * map.width + x] as number] as TerrainType;
    counts.set(type, (counts.get(type) ?? 0) + 1);
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
