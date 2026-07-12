import { DOMAINS, UNIT_DOMAIN, type Domain, type EntityId, type EntitySnapshot } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { getSelectionApi, type SelectionApi } from '../gameBridge.js';

// Truppenauswahl ueber das Terminal (docs/KONZEPT.md Abschnitt 5.3), als
// Ergaenzung zur Klick-Auswahl in main.ts - dieselbe Regel gilt hier: Feinde
// sind nie selektierbar.

const NO_DATA_HINT = 'Noch keine Spieldaten vom Server.';

// Liefert die API nur, wenn main.ts sie gebunden hat UND schon mindestens
// ein Snapshot da ist - sonst waeren alle IDs zwangslaeufig "unbekannt".
function getReadyApi(): SelectionApi | null {
  const api = getSelectionApi();
  if (!api || api.getUnits().length === 0) return null;
  return api;
}

function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

function formatSelection(api: SelectionApi): string {
  const selected = api.getSelection();
  if (selected.length === 0) return 'Keine Einheiten ausgewaehlt - "select <id...>" oder "select all" waehlt aus.';

  const units = api.getUnits();
  const width = Math.max(...selected.map((id) => id.length));
  const lines = ['Aktuelle Auswahl:'];
  for (const id of selected) {
    const unit = units.find((u) => u.id === id);
    lines.push(`${id.padEnd(width + 2)}${unit ? unit.unitType : '(nicht mehr im Spiel)'}`);
  }
  return lines.join('\n');
}

function selectAll(api: SelectionApi, domainArg: string | undefined): string {
  if (domainArg && !isDomain(domainArg)) {
    return `Unbekannte Domain "${domainArg}" - gueltig: ${DOMAINS.join(', ')}.`;
  }
  const domain = domainArg as Domain | undefined;

  const matches = api
    .getUnits()
    .filter((u) => u.faction === 'player' && (!domain || UNIT_DOMAIN[u.unitType] === domain));
  api.setSelection(matches.map((u) => u.id));

  if (matches.length === 0) {
    return domain ? `Keine eigenen Einheiten der Domain "${domain}".` : 'Keine eigenen Einheiten vorhanden.';
  }
  return `${matches.length} Einheit(en) ausgewaehlt.`;
}

function selectByIds(api: SelectionApi, ids: string[]): string {
  const units: EntitySnapshot[] = api.getUnits();
  const errors: string[] = [];
  const valid: EntityId[] = [];

  for (const id of ids) {
    const unit = units.find((u) => u.id === id);
    if (!unit) {
      errors.push(`Unbekannte Einheit-ID "${id}".`);
    } else if (unit.faction !== 'player') {
      errors.push(`"${id}" ist eine Feind-Einheit - nicht auswaehlbar.`);
    } else {
      valid.push(id);
    }
  }

  api.setSelection(valid);
  return [...errors, `${valid.length} Einheit(en) ausgewaehlt.`].join('\n');
}

registerCommand(
  'select',
  'Truppenauswahl: "select <id...>", "select all [land|water|air]", "select none", "select"/"select list" zeigt Auswahl.',
  (args) => {
    const api = getReadyApi();
    if (!api) return NO_DATA_HINT;

    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'list') return formatSelection(api);
    if (sub === 'none') {
      api.setSelection([]);
      return 'Auswahl geleert.';
    }
    if (sub === 'all') return selectAll(api, args[1]?.toLowerCase());

    return selectByIds(api, args);
  },
);
