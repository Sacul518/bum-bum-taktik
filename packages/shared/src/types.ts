export type Domain = 'land' | 'water' | 'air';

export type UnitType = 'tank' | 'infantry' | 'boat' | 'plane';

export interface Vector2 {
  x: number;
  y: number;
}

export type EntityId = string;
export type PlayerId = string;

export interface EntitySnapshot {
  id: EntityId;
  unitType: UnitType;
  x: number;
  y: number;
  heading: number;
  hp: number;
  /** Verbleibende Wegpunkte in Weltkoordinaten, naechster zuerst - fuer den Path-Tracker im Client. */
  path: Vector2[];
}
