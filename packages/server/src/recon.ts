import {
  RECON_COOLDOWN_MS,
  RECON_DURATION_MS,
  RECON_RADIUS_MAX,
  type ReconResultMessage,
  type ReconZone,
} from '@bum-bum-taktik/shared';

// Aufklaerungs-Sweep "recon" (docs/KONZEPT.md Abschnitt 6): haelt die aktiven
// Sweeps und die Team-Abklingzeit. Koop = geteilte Faehigkeit: EIN Cooldown
// fuer alle Spieler zusammen, sonst koennten sechs iPads die Karte dauerhaft
// aufgedeckt halten.

interface ActiveRecon extends ReconZone {
  expiresAt: number;
}

let activeRecons: ActiveRecon[] = [];
let cooldownUntil = 0;

export function requestRecon(x: number, y: number, radius: number): ReconResultMessage {
  const now = Date.now();
  if (now < cooldownUntil) {
    return { type: 'reconResult', accepted: false, remainingCooldownMs: cooldownUntil - now };
  }

  // Radius kommt als JSON von aussen: auf sinnvolle Grenzen klemmen statt
  // abzulehnen (ein zu grosser Wunsch ist kein Fehler, nur Uebermut).
  const clampedRadius = Math.min(Math.max(1, radius), RECON_RADIUS_MAX);
  activeRecons.push({ x, y, radius: clampedRadius, expiresAt: now + RECON_DURATION_MS });
  cooldownUntil = now + RECON_COOLDOWN_MS;
  return { type: 'reconResult', accepted: true, remainingCooldownMs: 0 };
}

/** Aktive Sweeps fuer diesen Tick (raeumt abgelaufene dabei auf). */
export function activeReconZones(): ReconZone[] {
  const now = Date.now();
  activeRecons = activeRecons.filter((recon) => recon.expiresAt > now);
  return activeRecons.map(({ x, y, radius }) => ({ x, y, radius }));
}

// Bei Karten-/Missionswechsel: Sweeps gehoeren zur alten Karte; die
// Abklingzeit bleibt bewusst stehen (sonst waere Missionsneustart ein
// Cooldown-Reset-Trick).
export function clearReconZones(): void {
  activeRecons = [];
}
