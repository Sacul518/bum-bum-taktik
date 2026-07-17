import { describeObjective, getMission, type MissionObjective } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getActiveMission, getObjectiveProgress } from '../gameBridge.js';

// "objective" (PLAN.md Session A, Aufgabe 4): zeigt Ziel und Fortschritt der
// aktiven Mission. Der Fortschritt kommt vom Server (StateUpdate.
// objectiveProgress) - der Client koennte z. B. zerstoerte Feinde im Fog of
// War gar nicht selbst zaehlen.

function formatProgress(objective: MissionObjective, progress: { done: number; total: number }): string {
  switch (objective.kind) {
    case 'eliminateAll':
      return `Feindeinheiten ${progress.done}/${progress.total} zerstoert`;
    case 'destroyHQ':
      return progress.done >= progress.total ? 'Feind-HQ zerstoert' : 'Feind-HQ steht noch';
    case 'captureCities':
      return `Staedte ${progress.done}/${progress.total}`;
  }
}

registerCommand('objective', 'Zeigt Ziel und Fortschritt der aktiven Mission.', () => {
  const missionId = getActiveMission();
  if (!missionId) return 'Keine aktive Mission - "mission list" zeigt die Missionen der Region.';

  const mission = getMission(missionId);
  if (!mission) return `Aktive Mission "${missionId}" ist unbekannt - Client und Server passen nicht zusammen?`;

  const lines = [`Mission: ${mission.name}`, `Ziel: ${describeObjective(mission.objective)}`];
  const progress = getObjectiveProgress();
  if (progress) lines.push(`Fortschritt: ${formatProgress(mission.objective, progress)}`);
  return lines.join('\n');
});
