export type Domain = 'land' | 'water' | 'air';

export type UnitType = 'tank' | 'infantry' | 'boat' | 'plane';

// Koop-Modus (docs/KONZEPT.md Abschnitt 0): alle Spieler teilen sich eine
// Fraktion, die Gegenseite ist die KI-Fraktion.
export type Faction = 'player' | 'enemy';

export interface Vector2 {
  x: number;
  y: number;
}

export type EntityId = string;
export type PlayerId = string;

export interface EntitySnapshot {
  id: EntityId;
  unitType: UnitType;
  faction: Faction;
  x: number;
  y: number;
  heading: number;
  hp: number;
  /** Verbleibende Wegpunkte in Weltkoordinaten, naechster zuerst - fuer den Path-Tracker im Client. */
  path: Vector2[];
  /**
   * Einheit ist durch einen erfolgreichen Hack lahmgelegt (bewegt sich nicht,
   * schiesst nicht) - docs/KONZEPT.md Abschnitt 9, Phase 3. Optional statt
   * immer false, damit die Snapshots im Normalfall nicht groesser werden.
   */
  stunned?: boolean;
}
