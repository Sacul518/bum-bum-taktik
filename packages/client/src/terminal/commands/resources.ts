import { BUILDING_INCOME_PER_S, BUILDINGS } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getResources, getSelectionApi } from '../gameBridge.js';

// Wirtschafts-Uebersicht (PLAN.md Session B): aktueller Kontostand plus das
// laufende Einkommen, aufgeschluesselt nach eigenen Einkommens-Gebaeuden -
// so sieht man sofort, warum sich das Einnehmen von Staedten/Minen lohnt.

registerCommand('resources', 'Kontostand (Credits/Material) und laufendes Einkommen.', () => {
  const resources = getResources();
  if (!resources) return 'Noch keine Spieldaten vom Server.';

  const lines = [`Credits:  ${resources.credits}`, `Material: ${resources.material}`, ''];

  const own = (getSelectionApi()?.getBuildings() ?? []).filter((building) => building.faction === 'player');
  let creditsPerS = 0;
  let materialPerS = 0;
  const sources: string[] = [];
  for (const building of own) {
    const income = BUILDING_INCOME_PER_S[building.buildingType];
    if (!income) continue;
    creditsPerS += income.credits ?? 0;
    materialPerS += income.material ?? 0;
    const parts = [];
    if (income.credits) parts.push(`+${income.credits} Credits/s`);
    if (income.material) parts.push(`+${income.material} Material/s`);
    sources.push(`  ${building.id.padEnd(14)}${BUILDINGS[building.buildingType].name.padEnd(14)}${parts.join(', ')}`);
  }

  lines.push(`Einkommen: +${creditsPerS} Credits/s, +${materialPerS} Material/s`);
  lines.push(...sources);
  lines.push('');
  lines.push('Credits kommen aus Staedten (und dem HQ), Material nur aus Minen - einnehmen lohnt sich.');
  return lines.join('\n');
});
