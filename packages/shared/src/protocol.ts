import type { BuildingSnapshot, BuildingType, EntityId, EntitySnapshot, Faction, PlayerId, ProjectileKind, UnitType } from './types.js';
import type { MapPresetId } from './procgen/presets.js';

// Server -> Client, beim Verbindungsaufbau und erneut nach jedem
// Kartenwechsel (selectMap) - der Client behandelt jedes hello als
// kompletten Neuaufbau der Welt.
export interface ServerHello {
  type: 'hello';
  playerId: PlayerId;
  preset: MapPresetId;
  /** Aktive Mission (docs/KONZEPT.md Abschnitt 3.2) oder null = freie Aufstellung. */
  missionId: string | null;
  /**
   * Bisher gewonnene Missionen (Missions-Kette, shared/missions.ts) - der
   * Client zeigt damit gesperrte Missionen an. Lebt nur im Server-Speicher,
   * Persistenz kommt in Session C.
   */
  wonMissionIds: string[];
  mapWidth: number;
  mapHeight: number;
  terrain: ArrayBuffer; // Terrain-Typ-Index pro Kachel (Uint8Array-Bytes)
  elevation: ArrayBuffer; // Hoehenwert -1..1 pro Kachel (Float32Array-Bytes)
}

// Ein Schuss, der in diesem Tick gefallen ist (Sofort-Treffer, der Schaden
// ist bereits abgezogen). Positionen sind mit dabei, damit der Client die
// Tracer-Linie auch dann zeichnen kann, wenn das Ziel im selben Tick
// zerstoert wurde und nicht mehr in "entities" auftaucht.
export interface ShotEvent {
  attackerId: EntityId;
  targetId: EntityId;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Waffen-Optik fuer den Tracer im Client (WEAPONS in constants.ts). */
  projectile: ProjectileKind;
}

// Aktiver Aufklaerungs-Sweep (docs/KONZEPT.md Abschnitt 6, "recon"): der
// Bereich zaehlt fuer die Dauer des Sweeps als eingesehen - der Server nutzt
// ihn fuer die Feind-Filterung, der Client hellt denselben Bereich im
// Fog-of-War-Overlay auf.
export interface ReconZone {
  x: number;
  y: number;
  radius: number;
}

// Spiel-Ereignisse fuers Terminal-Event-Log (PLAN.md Session A, Aufgabe 5):
// der Server erkennt sie per Vergleich mit dem vorigen Tick und schickt sie
// im StateUpdate mit, der Client druckt sie ins Terminal. "underFire" ist
// serverseitig pro Einheit gedrosselt (UNDER_FIRE_THROTTLE_MS in index.ts),
// damit Dauerbeschuss nicht jede Sekunde eine Zeile erzeugt.
export type GameEvent =
  | { kind: 'underFire'; unitId: EntityId; unitType: UnitType }
  | { kind: 'unitLost'; unitId: EntityId; unitType: UnitType }
  | { kind: 'buildingLost'; buildingId: EntityId; buildingType: BuildingType }
  | { kind: 'captured'; buildingId: EntityId; buildingType: BuildingType; byFaction: Faction }
  | { kind: 'produced'; unitId: EntityId; unitType: UnitType }
  | { kind: 'objective'; done: number; total: number };

// Server -> Client, pro Tick
export interface StateUpdate {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  shots: ShotEvent[];
  visibleEnemyIds: EntityId[]; // Fog-of-War: nur was das Team gerade sieht
  /**
   * Alle noch stehenden Gebaeude - bewusst IMMER komplett (auch im Fog of
   * War): Gebaeude sind statische Landmarken, die man auf der Karte kennt,
   * kein beweglicher Feind. Spart die Sichtbarkeits-Filterung.
   */
  buildings: BuildingSnapshot[];
  /** Nur gesetzt, solange mindestens ein Aufklaerungs-Sweep aktiv ist. */
  reconZones?: ReconZone[];
  /**
   * Missionsziel-Fortschritt, nur bei aktiver Mission (server/index.ts).
   * Bedeutung haengt vom Zieltyp ab (eliminateAll: zerstoerte von allen
   * Feindeinheiten; destroyHQ: 0/1; captureCities: eigene von geforderten
   * Staedten) - der Client kennt den Zieltyp aus der MissionDef.
   */
  objectiveProgress?: { done: number; total: number };
  /** Nur gesetzt, wenn in diesem Tick Ereignisse anfielen (GameEvent oben). */
  events?: GameEvent[];
}

// --- Hacking-Minispiel (docs/KONZEPT.md Abschnitt 9, Phase 3) ---
// Ablauf: Client schickt hackStart -> Server validiert und antwortet NUR dem
// Anforderer mit hackChallenge (Zugriffscode + Zeitlimit) -> Spieler tippt den
// Code im Terminal nach -> Client schickt hackAttempt -> Server antwortet mit
// hackResult. Der Stun-Effekt selbst steht fuer alle Clients im Snapshot
// (EntitySnapshot.stunned).

export interface HackChallengeMessage {
  type: 'hackChallenge';
  hackId: string;
  targetId: EntityId;
  /** Nachzutippender Zugriffscode, z. B. "A3 F0 7C 21". */
  code: string;
  timeLimitMs: number;
}

export type HackFailReason =
  | 'invalidTarget' // Ziel existiert nicht, ist kein Feind oder nicht sichtbar
  | 'outOfRange' // keine eigene Einheit in HACK_RANGE um das Ziel
  | 'alreadyHacking' // Ziel wird schon gehackt oder Anforderer hackt schon
  | 'wrongCode'
  | 'timeout'
  | 'aborted';

// Bei abgelehntem hackStart (invalidTarget/outOfRange/alreadyHacking) gibt es
// noch keine Challenge - dann ist hackId der Leerstring.
export interface HackResultMessage {
  type: 'hackResult';
  hackId: string;
  targetId: EntityId;
  success: boolean;
  reason?: HackFailReason;
}

// Missionsende (docs/KONZEPT.md Abschnitt 3.2): der Server broadcastet das
// Ergebnis genau einmal, sobald das Missionsziel erreicht ("won") bzw. die
// Niederlagebedingung erfuellt ist ("lost": alle eigenen Einheiten weg oder
// eigenes HQ gefallen). Die Welt laeuft danach weiter (kein Zwangs-Reset) -
// ein neuer "mission start"/"map select" raeumt auf.
export interface MissionEndMessage {
  type: 'missionEnd';
  missionId: string;
  outcome: 'won' | 'lost';
  /** Nur bei outcome 'lost': woran es lag. */
  reason?: 'unitsLost' | 'hqLost';
  /** Stand nach diesem Ergebnis - haelt die Freischaltungen im Client aktuell. */
  wonMissionIds: string[];
}

export type ServerMessage =
  | ServerHello
  | StateUpdate
  | HackChallengeMessage
  | HackResultMessage
  | MissionEndMessage
  | ReconResultMessage;

// ServerHello enthaelt ein ArrayBuffer (Terrain-Raster), das JSON.stringify
// nicht abbilden kann (wird sonst stillschweigend zu "{}"). Deshalb hier
// zentral als Base64-String innerhalb der JSON-Nachricht kodieren/dekodieren -
// btoa/atob sind sowohl in Node als auch im Browser verfuegbar, keine
// zusaetzliche Abhaengigkeit noetig.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function encodeServerMessage(message: ServerMessage): string {
  if (message.type === 'hello') {
    return JSON.stringify({
      ...message,
      terrain: arrayBufferToBase64(message.terrain),
      elevation: arrayBufferToBase64(message.elevation),
    });
  }
  return JSON.stringify(message);
}

export function decodeServerMessage(raw: string): ServerMessage {
  const parsed = JSON.parse(raw) as ServerMessage & { terrain?: string; elevation?: string };
  if (parsed.type === 'hello' && typeof parsed.terrain === 'string' && typeof parsed.elevation === 'string') {
    return { ...parsed, terrain: base64ToArrayBuffer(parsed.terrain), elevation: base64ToArrayBuffer(parsed.elevation) };
  }
  return parsed as ServerMessage;
}

// Client -> Server
export interface MoveCommand {
  type: 'move';
  unitIds: EntityId[];
  target: [number, number];
}

export interface AttackCommand {
  type: 'attack';
  unitId: EntityId;
  targetId: EntityId;
}

export interface TerminalCommand {
  type: 'terminalCmd';
  raw: string;
}

// Regionswahl uebers Terminal (docs/KONZEPT.md Abschnitt 3.1): eigener
// typisierter Befehl statt des rohen terminalCmd-Strings, damit der Server
// keine Terminal-Syntax parsen muss.
export interface SelectMapCommand {
  type: 'selectMap';
  preset: MapPresetId;
}

// Missionsstart uebers Terminal (docs/KONZEPT.md Abschnitt 3.2): der Server
// wechselt auf die Region der Mission und spawnt die Startaufstellung.
// missionId ist bewusst string (nicht Literal-Union): kommt als JSON von
// aussen, der Server prueft zur Laufzeit gegen MISSIONS.
export interface StartMissionCommand {
  type: 'startMission';
  missionId: string;
}

// Hacking-Minispiel: Start-Anfrage, Code-Eingabe und Abbruch (Gegenstuecke
// zu HackChallengeMessage/HackResultMessage oben).
export interface HackStartCommand {
  type: 'hackStart';
  targetId: EntityId;
}

export interface HackAttemptCommand {
  type: 'hackAttempt';
  hackId: string;
  answer: string;
}

export interface HackAbortCommand {
  type: 'hackAbort';
  hackId: string;
}

// Aufklaerungs-Sweep anfordern (docs/KONZEPT.md Abschnitt 6). Der Server
// prueft Radius-Limit und Team-Abklingzeit und antwortet dem Anforderer mit
// reconResult; der aktive Sweep selbst steht fuer alle in StateUpdate.
export interface ReconCommand {
  type: 'recon';
  x: number;
  y: number;
  radius: number;
}

export interface ReconResultMessage {
  type: 'reconResult';
  accepted: boolean;
  /** Bei Ablehnung wegen Abklingzeit: Restdauer in ms, sonst 0. */
  remainingCooldownMs: number;
}

// Transport (docs/KONZEPT.md Abschnitt 9): Infanterie laeuft zum eigenen
// Transporter und steigt ein, sobald sie nah genug ist (EMBARK_RANGE);
// disembark setzt alle Passagiere auf begehbare Nachbarkacheln ab. Beide
// Befehle validiert der Server (Fraktion, Kapazitaet, Platz zum Aussteigen).
export interface EmbarkCommand {
  type: 'embark';
  unitIds: EntityId[];
  transportId: EntityId;
}

export interface DisembarkCommand {
  type: 'disembark';
  transportId: EntityId;
}

export type ClientCommand =
  | MoveCommand
  | AttackCommand
  | TerminalCommand
  | SelectMapCommand
  | StartMissionCommand
  | HackStartCommand
  | HackAttemptCommand
  | HackAbortCommand
  | ReconCommand
  | EmbarkCommand
  | DisembarkCommand;
