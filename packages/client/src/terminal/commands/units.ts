import { MAX_HP } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getSelectionApi } from '../gameBridge.js';

// Einheiten-Uebersicht im Terminal (docs/KONZEPT.md Abschnitt 5.3/6): Tabelle
// der eigenen Einheiten plus - falls gerade welche sichtbar sind - die
// Feind-Einheiten aus demselben Snapshot (Fog-of-War-Ausschnitt).

registerCommand('units', 'Tabelle aller eigenen Einheiten (Auswahl/HP/Position) und sichtbarer Feinde.', () => {
  const api = getSelectionApi();
  const all = api?.getUnits() ?? [];
  if (all.length === 0) return 'Noch keine Spieldaten vom Server.';

  const own = all.filter((u) => u.faction === 'player');
  const enemies = all.filter((u) => u.faction === 'enemy');
  if (own.length === 0) return 'Keine eigenen Einheiten vorhanden.';

  const selected = new Set(api?.getSelection() ?? []);
  const idWidth = Math.max(...own.map((u) => u.id.length));
  const typeWidth = Math.max(...own.map((u) => u.unitType.length));

  const lines: string[] = [];
  for (const unit of own) {
    const marker = selected.has(unit.id) ? '*' : ' ';
    const hp = `${Math.round(unit.hp)}/${MAX_HP[unit.unitType]}`;
    const pos = `${Math.round(unit.x)},${Math.round(unit.y)}`;
    lines.push(`${marker} ${unit.id.padEnd(idWidth + 2)}${unit.unitType.padEnd(typeWidth + 2)}${hp.padEnd(9)}${pos}`);
  }

  if (enemies.length > 0) {
    lines.push('');
    lines.push('Sichtbare Feinde:');
    const enemyIdWidth = Math.max(...enemies.map((u) => u.id.length));
    const enemyTypeWidth = Math.max(...enemies.map((u) => u.unitType.length));
    for (const unit of enemies) {
      const hp = `${Math.round(unit.hp)}/${MAX_HP[unit.unitType]}`;
      lines.push(`${unit.id.padEnd(enemyIdWidth + 2)}${unit.unitType.padEnd(enemyTypeWidth + 2)}${hp}`);
    }
  }

  return lines.join('\n');
});
