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
}
