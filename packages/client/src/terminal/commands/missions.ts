import { MAP_PRESETS, missionsForRegion, type MapPresetId } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getCurrentPreset } from '../gameBridge.js';

// "missions" zeigt die Missionen der aktuellen Region (docs/KONZEPT.md
// Abschnitt 3.2). Der Missionsstart ("mission start <id>") folgt spaeter.

// Auch von main.ts benutzt: nach einem Kartenwechsel zeigt das Terminal die
// Missionen der neuen Region automatisch an.
export function formatMissionList(preset: MapPresetId): string {
  const missions = missionsForRegion(preset);
  if (missions.length === 0) return `Keine Missionen fuer Region "${MAP_PRESETS[preset].name}" definiert.`;

  const width = Math.max(...missions.map((m) => m.id.length));
  const lines = [`Missionen der Region ${MAP_PRESETS[preset].name}:`];
  for (const mission of missions) {
    lines.push(`${mission.id.padEnd(width + 2)}${mission.name} - ${mission.description}`);
  }
  return lines.join('\n');
}

registerCommand('missions', 'Zeigt die Missionen der aktuellen Region.', () => {
  const preset = getCurrentPreset();
  if (!preset) return 'Noch keine Karte vom Server erhalten.';
  return formatMissionList(preset);
});
