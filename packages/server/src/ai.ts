import { ENEMY_AGGRO_RANGE, canTarget } from '@bum-bum-taktik/shared';
import type { UnitState } from './gameLoop.js';

// Gegner-KI (docs/KONZEPT.md Abschnitt 9, Phase 2): reine Ziel-Erfassung,
// vor der Bewegung in advanceUnits aufgerufen. Die eigentliche Verfolgung und
// das Feuern uebernehmen die vorhandene updateAttackChase/selectFireTarget-
// Logik in gameLoop.ts, sobald attackTargetId gesetzt ist - hier wird nur
// entschieden, WER angegriffen wird.
//
// removeDeadUnits() setzt attackTargetId einer Einheit bereits auf null,
// sobald ihr Ziel stirbt - "ohne lebendes Angriffsziel" ist deshalb einfach
// attackTargetId === null. Einmal aggro, bleibt das Ziel bis zum Tod (kein
// Ablassen, kein Patrouillieren in dieser Ausbaustufe).
export function updateEnemyAggro(units: UnitState[]): void {
  for (const unit of units) {
    if (unit.faction !== 'enemy' || unit.attackTargetId) continue;

    let nearest: UnitState | null = null;
    let nearestDistance = Infinity;
    for (const other of units) {
      if (other.faction !== 'player') continue;
      // Nur Ziele erfassen, die die eigene Waffe treffen kann (WEAPONS.targets) -
      // ein Feind-Panzer soll nicht ewig einem Flugzeug hinterherfahren.
      if (!canTarget(unit.unitType, other.unitType)) continue;
      const distance = Math.hypot(other.x - unit.x, other.y - unit.y);
      if (distance <= ENEMY_AGGRO_RANGE && distance < nearestDistance) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    if (nearest) unit.attackTargetId = nearest.id;
  }
}
