import { HACK_STUN_MS, type HackResultMessage } from '@bum-bum-taktik/shared';
import { clearLineInterceptor, registerCommand, setLineInterceptor } from '../registry.js';
import { getSelectionApi, onHackMessage, sendGameCommand } from '../gameBridge.js';

// Hacking-Minispiel (docs/KONZEPT.md Abschnitt 9, Phase 3): "hack <zielId>"
// fordert beim Server eine Code-Challenge an. Kommt sie, schaltet der
// Line-Interceptor (registry.ts) das Terminal in den Eingabe-Modus: die
// naechste Zeile geht als Antwort an den Server statt an die Befehlssuche.
// Der Server entscheidet alles Weitere (Frist, Stun, Alarm) - hier lebt nur
// die Terminal-Fuehrung durch den Ablauf.

const ABORT_WORD = 'abbruch';

// Es kann nur einen laufenden Hack geben (der Server lehnt parallele eh mit
// alreadyHacking ab). print stammt aus dem TerminalContext des hack-Aufrufs;
// die Funktion ist ein stabiler Closure des Terminal-Widgets und darf fuer
// die asynchron eintreffenden Server-Antworten aufgehoben werden.
let pending: { targetId: string; hackId: string | null; print: (text: string) => void } | null = null;

const FAIL_TEXT: Record<NonNullable<HackResultMessage['reason']>, string> = {
  invalidTarget: 'Ziel ungueltig - existiert nicht (mehr), ist kein Feind oder nicht sichtbar.',
  outOfRange: 'Ausser Reichweite - eine eigene Einheit muss naeher ans Ziel (12 Kacheln).',
  alreadyHacking: 'Es laeuft bereits ein Hack auf dieses Ziel.',
  wrongCode: 'FALSCHER CODE. Zugriff verweigert - das Ziel ist alarmiert!',
  timeout: 'ZEIT ABGELAUFEN. Verbindung gekappt - das Ziel ist alarmiert!',
  aborted: 'Verbindung sauber getrennt - kein Alarm ausgeloest.',
};

onHackMessage((message) => {
  if (!pending) return;
  const print = pending.print;

  if (message.type === 'hackChallenge') {
    pending.hackId = message.hackId;
    print(`Verbindung zu ${message.targetId} steht.`);
    print(`ZUGRIFFSCODE: ${message.code}`);
    print(`Code innerhalb ${Math.round(message.timeLimitMs / 1000)}s eintippen ('${ABORT_WORD}' bricht ab):`);

    setLineInterceptor((line) => {
      clearLineInterceptor();
      if (!pending?.hackId) return '';
      if (line.trim().toLowerCase() === ABORT_WORD) {
        sendGameCommand({ type: 'hackAbort', hackId: pending.hackId });
        return 'Trenne Verbindung...';
      }
      sendGameCommand({ type: 'hackAttempt', hackId: pending.hackId, answer: line });
      return 'Pruefe Code...';
    });
    return;
  }

  // hackResult: Ablauf ist vorbei (Erfolg, Fehler oder abgelehnter Start).
  pending = null;
  clearLineInterceptor();
  if (message.success) {
    print(`ZUGRIFF GEWAEHRT - ${message.targetId} ist fuer ${Math.round(HACK_STUN_MS / 1000)}s lahmgelegt.`);
  } else {
    print(message.reason ? FAIL_TEXT[message.reason] : 'Hack fehlgeschlagen.');
  }
});

registerCommand('hack', 'Hackt eine sichtbare Feind-Einheit: "hack <zielId>" - Erfolg legt sie kurz lahm.', (args, ctx) => {
  const targetId = args[0];
  if (!targetId) return 'Verwendung: hack <zielId> - sichtbare Feinde zeigt "units".';
  if (pending) return 'Es laeuft schon ein Hack - erst abschliessen oder abbrechen.';

  // Fruehe, rein kosmetische Vorpruefung gegen den letzten Snapshot - die
  // verbindliche Entscheidung trifft der Server (hackResult mit Grund).
  const units = getSelectionApi()?.getUnits() ?? [];
  const target = units.find((u) => u.id === targetId);
  if (target && target.faction === 'player') return 'Eigene Einheiten lassen sich nicht hacken.';

  if (!sendGameCommand({ type: 'hackStart', targetId })) return 'Keine Verbindung zum Server.';
  pending = { targetId, hackId: null, print: ctx.print };
  return `Verbinde mit ${targetId} ...`;
});
