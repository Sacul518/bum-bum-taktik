export type Domain = 'land' | 'water' | 'air';

export type UnitType = 'tank' | 'infantry' | 'boat' | 'plane';

// Optik eines Schusses im Client (Tracer-Farbe/-Dauer) - der Server legt sie
// ueber das Waffenprofil (constants.ts) fest und schickt sie im ShotEvent mit.
// 'flak' ist fuer die spaeteren Verteidigungstuerme reserviert.
export type ProjectileKind = 'shell' | 'bullet' | 'rocket' | 'flak';

// Koop-Modus (docs/KONZEPT.md Abschnitt 0): alle Spieler teilen sich eine
// Fraktion, die Gegenseite ist die KI-Fraktion.
export type Faction = 'player' | 'enemy';

export interface Vector2 {
  x: number;
  y: number;
}

export type EntityId = string;
export type PlayerId = string;

// Gebaeude (docs/KONZEPT.md Abschnitt 9, "Gebaeude & Basen"): statische
// Landmarken auf Landkacheln. Staedte starten neutral und koennen von
// Infanterie eingenommen werden (BUILDINGS in constants.ts sagt, welche
// Typen einnehmbar sind). Seit Session B (PLAN.md) dazu die Wirtschafts-
// POIs: Mine (Material), Kaserne/Hafen/Flugplatz (Produktion).
export type BuildingType = 'hq' | 'factory' | 'city' | 'tower' | 'mine' | 'barracks' | 'harbor' | 'airfield';

export type BuildingFaction = Faction | 'neutral';

export interface BuildingSnapshot {
  id: EntityId;
  buildingType: BuildingType;
  faction: BuildingFaction;
  x: number;
  y: number;
  hp: number;
  /** Einnahme-Fortschritt 0..1 - nur gesetzt, waehrend eine Einnahme laeuft. */
  captureProgress?: number;
  /** Fraktion, die gerade einnimmt - nur zusammen mit captureProgress gesetzt. */
  captureBy?: Faction;
}

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
  /**
   * Anzahl eingestiegener Einheiten (nur bei Transportern mit Passagieren
   * gesetzt, TRANSPORT_CAPACITY in constants.ts). Die Passagiere selbst
   * tauchen nicht in den Snapshots auf, solange sie eingestiegen sind.
   */
  passengers?: number;
  /**
   * Einheit kaempft gerade (Angriffsbefehl aktiv oder kuerzlich gefeuert) -
   * fuer die Zustandsspalte des status-Terminalbefehls.
   */
  fighting?: boolean;
}
