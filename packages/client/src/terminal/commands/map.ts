import { MAP_PRESETS, isMapPresetId } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { sendGameCommand } from '../gameBridge.js';

// Regionen-Befehle (docs/KONZEPT.md Abschnitt 3.1): "map list" zeigt die
// verfuegbaren Presets, "map select <id>" schickt den typisierten
// selectMap-Befehl an den Server - der antwortet mit einem neuen hello an
// alle Clients (Karte + Einheiten neu, siehe main.ts).

registerCommand('map', 'Regionen: "map list" zeigt alle Karten, "map select <id>" wechselt.', (args) => {
  const sub = args[0]?.toLowerCase();

  if (sub === 'list') {
    const presets = Object.values(MAP_PRESETS);
    const width = Math.max(...presets.map((p) => p.id.length));
    return presets
      .map((p) => `${p.id.padEnd(width + 2)}${p.name} (${p.width}x${p.height}) - ${p.description}`)
      .join('\n');
  }

  if (sub === 'select') {
    const id = args[1]?.toLowerCase();
    if (!id) return 'Verwendung: map select <id> - die IDs zeigt "map list".';
    if (!isMapPresetId(id)) return `Unbekannte Region "${id}" - "map list" zeigt alle verfuegbaren.`;
    if (!sendGameCommand({ type: 'selectMap', preset: id })) return 'Keine Verbindung zum Server.';
    return `Region "${MAP_PRESETS[id].name}" angefordert - Karte wird gewechselt...`;
  }

  return 'Verwendung: map list | map select <id>';
}, (args, argIndex) => {
  if (argIndex === 0) return ['list', 'select'];
  if (argIndex === 1 && args[0]?.toLowerCase() === 'select') return Object.keys(MAP_PRESETS);
  return [];
});
