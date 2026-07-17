import { TRANSPORT_CAPACITY, type EntitySnapshot } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getSelectionApi, sendGameCommand } from '../gameBridge.js';

// Transport-Befehle (Aufgabe "Infanterie-/Fahrzeug-Interaktion"): "board"
// schickt die ausgewaehlte Infanterie zum Einsteigen, "unboard" setzt die
// Passagiere ab. Alternativ zum Terminal geht Einsteigen auch per Klick auf
// den eigenen Transporter (main.ts). Verbindlich validiert der Server.

function ownTransports(): EntitySnapshot[] {
  const units = getSelectionApi()?.getUnits() ?? [];
  return units.filter((u) => u.faction === 'player' && TRANSPORT_CAPACITY[u.unitType] > 0);
}

registerCommand(
  'board',
  'Ausgewaehlte Infanterie steigt in einen Transporter: "board <transportId>" (Boot: 4 Plaetze, Flugzeug: 2).',
  (args) => {
    const transportId = args[0];
    if (!transportId) return 'Verwendung: board <transportId> - eigene Transporter zeigt "units".';
    const api = getSelectionApi();
    if (!api || api.getUnits().length === 0) return 'Noch keine Spieldaten vom Server.';

    const transport = api.getUnits().find((u) => u.id === transportId);
    if (!transport || transport.faction !== 'player') return `Kein eigener Transporter mit ID "${transportId}".`;
    const capacity = TRANSPORT_CAPACITY[transport.unitType];
    if (capacity === 0) return `${transport.unitType} nimmt keine Passagiere - nur Boot (4) und Flugzeug (2).`;

    const infantryIds = api
      .getSelection()
      .filter((id) => api.getUnits().find((u) => u.id === id)?.unitType === 'infantry');
    if (infantryIds.length === 0) return 'Keine Infanterie ausgewaehlt - nur Infanterie kann einsteigen.';

    const free = capacity - (transport.passengers ?? 0);
    if (free <= 0) return `${transportId} ist voll (${capacity}/${capacity}).`;

    if (!sendGameCommand({ type: 'embark', unitIds: infantryIds, transportId })) return 'Keine Verbindung zum Server.';
    return `${infantryIds.length} Einheit(en) laufen zu ${transportId} und steigen ein (${free} Platz/Plaetze frei).`;
  },
  (_args, argIndex) => (argIndex === 0 ? ownTransports().map((u) => u.id) : []),
);

registerCommand(
  'unboard',
  'Passagiere steigen aus: "unboard <transportId>" oder "unboard" (nutzt den ausgewaehlten Transporter).',
  (args) => {
    const api = getSelectionApi();
    if (!api || api.getUnits().length === 0) return 'Noch keine Spieldaten vom Server.';

    // Ohne Argument: der (erste) ausgewaehlte eigene Transporter.
    const transportId =
      args[0] ??
      api.getSelection().find((id) => {
        const unit = api.getUnits().find((u) => u.id === id);
        return unit !== undefined && TRANSPORT_CAPACITY[unit.unitType] > 0;
      });
    if (!transportId) return 'Verwendung: unboard <transportId> - oder vorher einen Transporter auswaehlen.';

    const transport = api.getUnits().find((u) => u.id === transportId);
    if (!transport || transport.faction !== 'player') return `Kein eigener Transporter mit ID "${transportId}".`;
    if (!transport.passengers) return `${transportId} hat keine Passagiere.`;

    if (!sendGameCommand({ type: 'disembark', transportId })) return 'Keine Verbindung zum Server.';
    return `${transport.passengers} Passagier(e) steigen aus ${transportId} aus (brauchen begehbare Kacheln daneben).`;
  },
  (_args, argIndex) => (argIndex === 0 ? ownTransports().filter((u) => (u.passengers ?? 0) > 0).map((u) => u.id) : []),
);
