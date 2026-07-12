import { MAP_PRESETS, getMission, missionsForRegion, type MapPresetId } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getCurrentPreset, sendGameCommand } from '../gameBridge.js';

// Missionsbefehle (docs/KONZEPT.md Abschnitt 3.2): "mission list" zeigt die
// Missionen der aktuellen Region, "mission start <id>" fordert den Start beim
// Server an. "missions" ist die alte Kurzform und bleibt aus Gewohnheit
// erhalten - teilt sich dieselbe Logik, damit "missions start <id>" ebenfalls
// funktioniert.

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
  lines.push('');
  lines.push('"mission start <id>" startet eine Mission.');
  return lines.join('\n');
}

function listMissions(): string {
  const preset = getCurrentPreset();
  if (!preset) return 'Noch keine Karte vom Server erhalten.';
  return formatMissionList(preset);
}

// missionId kommt roh vom Spieler - Gross-/Kleinschreibung wie bei "map
// select" grosszuegig behandeln (Ids sind ohnehin durchgehend klein).
function startMission(rawId: string | undefined): string {
  if (!rawId) return 'Verwendung: mission start <id> - die IDs zeigt "mission list".';
  const id = rawId.toLowerCase();
  const mission = getMission(id);

  if (!mission) {
    const preset = getCurrentPreset();
    const validIds = preset
      ? missionsForRegion(preset).map((m) => m.id).join(', ') || '(keine fuer diese Region)'
      : '(noch keine Region gewaehlt - "map list" zeigt alle Regionen)';
    return `Unbekannte Mission "${id}" - gueltige IDs der aktuellen Region: ${validIds}`;
  }

  if (!sendGameCommand({ type: 'startMission', missionId: mission.id })) return 'Keine Verbindung zum Server.';

  let result = `Mission '${mission.name}' angefordert...`;
  const preset = getCurrentPreset();
  if (preset && mission.region !== preset) {
    result += ` Hinweis: Region wechselt zu "${MAP_PRESETS[mission.region].name}".`;
  }
  return result;
}

function handleMissionCommand(args: string[]): string {
  const sub = args[0]?.toLowerCase();
  if (!sub || sub === 'list') return listMissions();
  if (sub === 'start') return startMission(args[1]);
  return 'Verwendung: mission list | mission start <id>';
}

registerCommand('mission', 'Missionen: "mission list" zeigt die der aktuellen Region, "mission start <id>" startet eine.', (args) =>
  handleMissionCommand(args),
);

registerCommand('missions', 'Kurzform fuer "mission list" - "missions start <id>" funktioniert ebenfalls.', (args) =>
  handleMissionCommand(args),
);
