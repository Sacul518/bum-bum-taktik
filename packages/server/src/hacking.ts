import {
  HACK_CODE_BYTES,
  HACK_RANGE,
  HACK_STUN_MS,
  HACK_TIME_LIMIT_MS,
  VISION_RANGE,
  type HackChallengeMessage,
  type HackResultMessage,
  type PlayerId,
} from '@bum-bum-taktik/shared';
import type { UnitState } from './gameLoop.js';

// Hacking-Minispiel (docs/KONZEPT.md Abschnitt 9, Phase 3): verwaltet die
// laufenden Hack-Versuche. Der Ablauf (hackStart -> hackChallenge ->
// hackAttempt -> hackResult) steht in shared/protocol.ts; hier lebt nur der
// Server-Zustand dazu. Wie ai.ts mutiert dieses Modul den Einheiten-Zustand
// direkt ueber das uebergebene units-Array (stunnedMs, attackTargetId).

interface ActiveHack {
  hackId: string;
  targetId: string;
  requesterId: PlayerId;
  /** Loesung normalisiert (Grossbuchstaben, ohne Leerzeichen), z. B. "A3F07C21". */
  code: string;
  /** Absolute Frist (Date.now()-Basis) - echte Zeit, nicht Ticks, weil der Spieler gegen die Uhr tippt. */
  deadlineAt: number;
}

let nextHackNumber = 1;
const activeHacks = new Map<string, ActiveHack>();

function normalizeAnswer(answer: string): string {
  return answer.replace(/\s+/g, '').toUpperCase();
}

function generateCode(): { display: string; normalized: string } {
  const bytes: string[] = [];
  for (let i = 0; i < HACK_CODE_BYTES; i++) {
    bytes.push(
      Math.floor(Math.random() * 256)
        .toString(16)
        .toUpperCase()
        .padStart(2, '0'),
    );
  }
  return { display: bytes.join(' '), normalized: bytes.join('') };
}

function fail(hackId: string, targetId: string, reason: NonNullable<HackResultMessage['reason']>): HackResultMessage {
  return { type: 'hackResult', hackId, targetId, success: false, reason };
}

// Nur sichtbare Feinde sind hackbar - dieselbe Sicht-Regel wie in
// visibility.ts (Muendungsfeuer zaehlt hier nicht: wer die Einheit nur ueber
// einen Tracer kennt, hat keine stabile Verbindung fuers Hacken).
function isVisibleToPlayers(target: UnitState, units: UnitState[]): boolean {
  return units.some(
    (unit) =>
      unit.faction === 'player' && Math.hypot(target.x - unit.x, target.y - unit.y) <= VISION_RANGE[unit.unitType],
  );
}

// Fehlgeschlagener Hack (falscher Code / Timeout) alarmiert das Ziel: es
// nimmt sofort die naechste Spieler-Einheit ins Visier - bewusst ohne
// ENEMY_AGGRO_RANGE-Limit, der Funkverkehr kam ja nachweislich aus der Naehe
// (HACK_RANGE). Verfolgung/Feuer laufen dann ueber die vorhandene
// attackTargetId-Logik in gameLoop.ts.
function alarmTarget(target: UnitState, units: UnitState[]): void {
  let nearest: UnitState | null = null;
  let nearestDistance = Infinity;
  for (const unit of units) {
    if (unit.faction !== 'player') continue;
    const distance = Math.hypot(unit.x - target.x, unit.y - target.y);
    if (distance < nearestDistance) {
      nearest = unit;
      nearestDistance = distance;
    }
  }
  if (nearest) target.attackTargetId = nearest.id;
}

export function startHack(targetId: string, requesterId: PlayerId, units: UnitState[]): HackChallengeMessage | HackResultMessage {
  const target = units.find((unit) => unit.id === targetId);
  if (!target || target.faction !== 'enemy' || !isVisibleToPlayers(target, units)) {
    return fail('', targetId, 'invalidTarget');
  }

  const inRange = units.some(
    (unit) => unit.faction === 'player' && Math.hypot(target.x - unit.x, target.y - unit.y) <= HACK_RANGE,
  );
  if (!inRange) return fail('', targetId, 'outOfRange');

  for (const hack of activeHacks.values()) {
    if (hack.targetId === targetId || hack.requesterId === requesterId) return fail('', targetId, 'alreadyHacking');
  }

  const code = generateCode();
  const hackId = `hack-${nextHackNumber++}`;
  activeHacks.set(hackId, {
    hackId,
    targetId,
    requesterId,
    code: code.normalized,
    deadlineAt: Date.now() + HACK_TIME_LIMIT_MS,
  });

  return { type: 'hackChallenge', hackId, targetId, code: code.display, timeLimitMs: HACK_TIME_LIMIT_MS };
}

export function attemptHack(hackId: string, answer: string, requesterId: PlayerId, units: UnitState[]): HackResultMessage {
  const hack = activeHacks.get(hackId);
  // Unbekannte hackId oder fremder Hack: als invalidTarget ablehnen (die
  // targetId ist dann unbekannt bzw. geht den Anforderer nichts an).
  if (!hack || hack.requesterId !== requesterId) return fail(hackId, '', 'invalidTarget');

  activeHacks.delete(hackId);
  const target = units.find((unit) => unit.id === hack.targetId);

  // Ziel ist zwischenzeitlich gestorben: kein Erfolg, aber auch kein Alarm.
  if (!target) return fail(hackId, hack.targetId, 'invalidTarget');

  if (Date.now() > hack.deadlineAt) {
    alarmTarget(target, units);
    return fail(hackId, hack.targetId, 'timeout');
  }

  if (normalizeAnswer(answer) !== hack.code) {
    alarmTarget(target, units);
    return fail(hackId, hack.targetId, 'wrongCode');
  }

  target.stunnedMs = HACK_STUN_MS;
  return { type: 'hackResult', hackId, targetId: hack.targetId, success: true };
}

// Abbruch durch den Spieler: kein Alarm (die Verbindung wurde sauber
// getrennt, bevor der Einbruch auffiel) - bewusste Belohnung fuers Aufgeben
// statt wild raten. Null = unbekannte/fremde hackId, nichts zu senden.
export function abortHack(hackId: string, requesterId: PlayerId): HackResultMessage | null {
  const hack = activeHacks.get(hackId);
  if (!hack || hack.requesterId !== requesterId) return null;
  activeHacks.delete(hackId);
  return fail(hackId, hack.targetId, 'aborted');
}

// Pro Tick aufrufen: abgelaufene Hacks aufraeumen, Ziele alarmieren und die
// Timeout-Ergebnisse samt Empfaenger zurueckgeben (der Server muss sie aktiv
// an den jeweiligen Anforderer schicken - unicast, siehe protocol.ts).
export function expireTimedOutHacks(units: UnitState[]): { requesterId: PlayerId; result: HackResultMessage }[] {
  const now = Date.now();
  const results: { requesterId: PlayerId; result: HackResultMessage }[] = [];

  for (const hack of [...activeHacks.values()]) {
    if (now <= hack.deadlineAt) continue;
    activeHacks.delete(hack.hackId);
    const target = units.find((unit) => unit.id === hack.targetId);
    if (target) alarmTarget(target, units);
    results.push({ requesterId: hack.requesterId, result: fail(hack.hackId, hack.targetId, 'timeout') });
  }

  return results;
}

// Bei Karten-/Missionswechsel: alle Einheiten werden ersetzt, laufende Hacks
// zeigen ins Leere und werden verworfen (ohne Ergebnis-Nachricht - der Client
// baut die Welt ohnehin komplett neu auf und raeumt seinen Hack-Zustand auf).
export function clearAllHacks(): void {
  activeHacks.clear();
}
