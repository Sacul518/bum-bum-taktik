export type Domain = 'land' | 'water' | 'air';

export interface Vector2 {
  x: number;
  y: number;
}

export type EntityId = string;
export type PlayerId = string;

export interface EntitySnapshot {
  id: EntityId;
  domain: Domain;
  x: number;
  y: number;
  heading: number;
  hp: number;
}
