import { MAP_PRESETS } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';

// Regionen-Befehle (docs/KONZEPT.md Abschnitt 3.1): "map list" zeigt die
// verfuegbaren Presets. "map select <id>" folgt, sobald der Server den
// Kartenwechsel unterstuetzt.

registerCommand('map', 'Regionen: "map list" zeigt alle verfuegbaren Karten.', (args) => {
  const sub = args[0]?.toLowerCase();

  if (sub === 'list') {
    const presets = Object.values(MAP_PRESETS);
    const width = Math.max(...presets.map((p) => p.id.length));
    return presets
      .map((p) => `${p.id.padEnd(width + 2)}${p.name} (${p.width}x${p.height}) - ${p.description}`)
      .join('\n');
  }

  return 'Verwendung: map list';
});
