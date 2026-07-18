import { BUILDINGS } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getSelectionApi } from '../gameBridge.js';

// Gebaeude-Uebersicht im Terminal (Aufgabe "Gebaeude & Basen"): alle Gebaeude
// mit Fraktion, HP und laufender Einnahme. Gebaeude sind immer komplett im
// Snapshot (protocol.ts), es gibt hier also keinen Fog-of-War-Ausschnitt.

registerCommand('buildings', 'Tabelle aller Gebaeude (Fraktion/HP/Position/Einnahme-Fortschritt).', () => {
  const api = getSelectionApi();
  const all = api?.getBuildings() ?? [];
  if (all.length === 0) return 'Keine Gebaeude vorhanden (oder noch keine Spieldaten vom Server).';

  const idWidth = Math.max(...all.map((b) => b.id.length));
  const factionWidth = Math.max(...all.map((b) => b.faction.length));

  const lines: string[] = [];
  for (const building of all) {
    const hp = `${Math.round(building.hp)}/${BUILDINGS[building.buildingType].maxHp}`;
    const pos = `${Math.round(building.x)},${Math.round(building.y)}`;
    const capture = building.captureProgress
      ? `  Einnahme ${Math.round(building.captureProgress * 100)}% (${building.captureBy})`
      : '';
    const production = building.production
      ? `  baut ${building.production.unitType} (${Math.round(building.production.progress * 100)}%)`
      : '';
    lines.push(`${building.id.padEnd(idWidth + 2)}${building.faction.padEnd(factionWidth + 2)}${hp.padEnd(9)}${pos}${capture}${production}`);
  }
  lines.push('');
  lines.push('Klick auf ein feindliches/neutrales Gebaeude = Angriff. Infanterie daneben nimmt einnehmbare Gebaeude ein.');
  lines.push('"produce <einheit>" baut Einheiten an eigenen Produktionsgebaeuden (Kostentabelle: "produce").');

  return lines.join('\n');
});
