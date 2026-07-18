import { BUILDINGS, PRODUCTION_BUILDING, PRODUCTION_TIME_MS, UNIT_COST, type UnitType } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getSelectionApi, onProduceResult, sendGameCommand } from '../gameBridge.js';

// Produktion (PLAN.md Session B): "produce <einheit> [gebaeudeId]" bestellt
// eine Einheit am passenden eigenen Gebaeude. Kosten/Belegung prueft der
// Server (buildings.ts startProduction), die Antwort kommt als
// produceResult - gleiche Terminal-Fuehrung wie beim recon-Befehl.

const UNIT_TYPES = Object.keys(UNIT_COST) as UnitType[];

function costTable(): string {
  const lines = ['Einheit     Kosten            Bauzeit  Gebaeude'];
  for (const unitType of UNIT_TYPES) {
    const cost = UNIT_COST[unitType];
    const costText = `${cost.credits} Credits${cost.material > 0 ? ` + ${cost.material} Material` : ''}`;
    const building = BUILDINGS[PRODUCTION_BUILDING[unitType]].name;
    lines.push(`${unitType.padEnd(12)}${costText.padEnd(18)}${`${PRODUCTION_TIME_MS[unitType] / 1000}s`.padEnd(9)}${building}`);
  }
  lines.push('');
  lines.push('Verwendung: produce <einheit> [gebaeudeId] - das Gebaeude muss dir gehoeren (einnehmen!).');
  return lines.join('\n');
}

let pendingPrint: ((text: string) => void) | null = null;

onProduceResult((message) => {
  if (!pendingPrint) return;
  const print = pendingPrint;
  pendingPrint = null;
  if (message.accepted) {
    const seconds = PRODUCTION_TIME_MS[message.unitType as UnitType] / 1000;
    print(`Produktion gestartet: ${message.unitType} bei ${message.buildingId} (fertig in ${seconds}s).`);
    return;
  }
  switch (message.reason) {
    case 'unknownUnit':
      print(`Unbekannter Einheitentyp "${message.unitType}" - verfuegbar: ${UNIT_TYPES.join(', ')}.`);
      break;
    case 'noBuilding': {
      const required = BUILDINGS[PRODUCTION_BUILDING[message.unitType as UnitType]].name;
      print(`Kein eigenes Gebaeude fuer ${message.unitType} - dafuer brauchst du eine ${required} (neutral? erst einnehmen).`);
      break;
    }
    case 'busy':
      print('Das Gebaeude baut bereits - warte, bis die laufende Produktion fertig ist.');
      break;
    case 'cost': {
      const cost = UNIT_COST[message.unitType as UnitType];
      print(`Zu teuer: ${message.unitType} kostet ${cost.credits} Credits${cost.material > 0 ? ` + ${cost.material} Material` : ''} ("resources" zeigt deinen Kontostand).`);
      break;
    }
    default:
      print('Produktion abgelehnt.');
  }
});

registerCommand(
  'produce',
  'Baut eine Einheit am passenden Gebaeude: "produce <einheit> [gebaeudeId]", ohne Argumente Kostentabelle.',
  (args, ctx) => {
    const unitType = args[0]?.toLowerCase();
    if (!unitType) return costTable();

    const buildingId = args[1];
    if (!sendGameCommand({ type: 'produce', unitType, ...(buildingId ? { buildingId } : {}) })) {
      return 'Keine Verbindung zum Server.';
    }
    pendingPrint = ctx.print;
    return `Bestelle ${unitType} ...`;
  },
  (args, argIndex) => {
    if (argIndex === 0) return UNIT_TYPES;
    if (argIndex === 1) {
      const unitType = args[0]?.toLowerCase() as UnitType | undefined;
      const required = unitType && unitType in PRODUCTION_BUILDING ? PRODUCTION_BUILDING[unitType] : null;
      return (getSelectionApi()?.getBuildings() ?? [])
        .filter((building) => building.faction === 'player' && (!required || building.buildingType === required))
        .map((building) => building.id);
    }
    return [];
  },
);
