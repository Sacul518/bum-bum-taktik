import type { EntitySnapshot } from '@bum-bum-taktik/shared';
import { TICK_INTERVAL_MS } from '@bum-bum-taktik/shared';

// Platzhalter-Einheit fuer den Walking Skeleton: bewegt sich nur, wenn der
// Client per MoveCommand ein Ziel schickt (kein Eingabe-System noetig,
// das kommt erst in Phase 1 - hier reicht ein direktes Ziel).
const MOVE_SPEED_UNITS_PER_S = 8;
const ARRIVAL_EPSILON = 0.05;

interface UnitState {
  id: string;
  x: number;
  y: number;
  heading: number;
  targetX: number | null;
  targetY: number | null;
}

const unit: UnitState = {
  id: 'unit-1',
  x: 0,
  y: 0,
  heading: 0,
  targetX: null,
  targetY: null,
};

export function setUnitTarget(x: number, y: number): void {
  unit.targetX = x;
  unit.targetY = y;
}

export function advanceUnit(): EntitySnapshot {
  if (unit.targetX !== null && unit.targetY !== null) {
    const dx = unit.targetX - unit.x;
    const dy = unit.targetY - unit.y;
    const distance = Math.hypot(dx, dy);
    const step = (MOVE_SPEED_UNITS_PER_S * TICK_INTERVAL_MS) / 1000;

    if (distance <= Math.max(step, ARRIVAL_EPSILON)) {
      unit.x = unit.targetX;
      unit.y = unit.targetY;
      unit.targetX = null;
      unit.targetY = null;
    } else {
      unit.heading = Math.atan2(dy, dx);
      unit.x += (dx / distance) * step;
      unit.y += (dy / distance) * step;
    }
  }

  return {
    id: unit.id,
    domain: 'land',
    x: unit.x,
    y: unit.y,
    heading: unit.heading,
    hp: 100,
  };
}
