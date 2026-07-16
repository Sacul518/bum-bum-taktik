import { RECON_DURATION_MS, RECON_RADIUS_DEFAULT, RECON_RADIUS_MAX } from '@bum-bum-taktik/shared';
import { registerCommand } from '../registry.js';
import { onReconResult, sendGameCommand } from '../gameBridge.js';

// Aufklaerungs-Sweep (docs/KONZEPT.md Abschnitt 6): "recon <x> <y> [radius]"
// deckt den Bereich voruebergehend auf. Team-Cooldown und Radius-Limit
// entscheidet der Server (server/src/recon.ts) - hier lebt nur die
// Terminal-Fuehrung, wie beim hack-Befehl.

let pendingPrint: ((text: string) => void) | null = null;

onReconResult((message) => {
  if (!pendingPrint) return;
  const print = pendingPrint;
  pendingPrint = null;
  if (message.accepted) {
    print(`Aufklaerung laeuft - der Bereich ist ${Math.round(RECON_DURATION_MS / 1000)}s lang sichtbar.`);
  } else {
    print(`Aufklaerung nicht bereit - noch ${Math.ceil(message.remainingCooldownMs / 1000)}s Abklingzeit (gilt fuers ganze Team).`);
  }
});

registerCommand(
  'recon',
  `Aufklaerungs-Sweep: "recon <x> <y> [radius]" deckt den Bereich kurz auf (Radius max. ${RECON_RADIUS_MAX}).`,
  (args, ctx) => {
    const x = Number(args[0]);
    const y = Number(args[1]);
    const radius = args[2] === undefined ? RECON_RADIUS_DEFAULT : Number(args[2]);
    if (args.length < 2 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) {
      return 'Verwendung: recon <x> <y> [radius] - Koordinaten wie in "units" angezeigt.';
    }

    if (!sendGameCommand({ type: 'recon', x, y, radius })) return 'Keine Verbindung zum Server.';
    pendingPrint = ctx.print;
    return `Fordere Aufklaerung bei ${Math.round(x)},${Math.round(y)} an ...`;
  },
);
