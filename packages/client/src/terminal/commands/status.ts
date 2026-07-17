import { MAX_HP, type EntitySnapshot } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getSelectionApi } from '../gameBridge.js';

// "status" (PLAN.md Session A, Aufgabe 5): wie "units", aber mit
// Zustandsspalte. Eingestiegene Einheiten stehen bewusst nicht in den
// Snapshots (gameLoop.ts) - sie erscheinen als Passagier-Zahl beim
// jeweiligen Transport statt als eigene Zeile.

function unitState(unit: EntitySnapshot): string {
  if (unit.stunned) return 'gehackt';
  if (unit.fighting) return 'kaempft';
  if (unit.path.length > 0) return 'bewegt';
  return 'idle';
}

registerCommand('status', 'Tabelle aller eigenen Einheiten mit HP, Zustand und Position.', () => {
  const api = getSelectionApi();
  const own = (api?.getUnits() ?? []).filter((unit) => unit.faction === 'player');
  if (own.length === 0) return 'Keine eigenen Einheiten (oder noch keine Spieldaten vom Server).';

  const rows = own.map((unit) => ({
    id: unit.id,
    type: unit.unitType,
    hp: `${Math.round(unit.hp)}/${MAX_HP[unit.unitType]}`,
    state: unitState(unit) + (unit.passengers ? ` (${unit.passengers} eingestiegen)` : ''),
    pos: `${Math.round(unit.x)},${Math.round(unit.y)}`,
  }));

  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const typeWidth = Math.max(...rows.map((row) => row.type.length));
  const stateWidth = Math.max(...rows.map((row) => row.state.length));

  return rows
    .map((row) => `${row.id.padEnd(idWidth + 2)}${row.type.padEnd(typeWidth + 2)}${row.hp.padEnd(9)}${row.state.padEnd(stateWidth + 2)}${row.pos}`)
    .join('\n');
});
