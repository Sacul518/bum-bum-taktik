import type {
  BuildingSnapshot,
  ClientCommand,
  EntityId,
  EntitySnapshot,
  HackChallengeMessage,
  HackResultMessage,
  MapPresetId,
  ReconResultMessage,
  ResourceAmount,
} from '@bum-bum-taktik/shared';

// Bruecke zwischen Terminal-Befehlen und dem Spiel in main.ts: die Befehle
// registrieren sich per Import-Nebeneffekt (registry.ts) und koennen daher
// nicht direkt an Socket/Spielzustand kommen - main.ts hinterlegt beides
// hier, sobald es existiert.

let sendFn: ((command: ClientCommand) => void) | null = null;
let currentPreset: MapPresetId | null = null;

export function bindGameCommands(send: (command: ClientCommand) => void): void {
  sendFn = send;
}

/** main.ts setzt das Preset bei jedem hello (Verbindungsaufbau + Kartenwechsel). */
export function setCurrentPreset(preset: MapPresetId): void {
  currentPreset = preset;
}

/** null, solange noch kein hello vom Server angekommen ist. */
export function getCurrentPreset(): MapPresetId | null {
  return currentPreset;
}

// Kampagnen-Zustand (PLAN.md Session A, Aufgabe 4): gewonnene Missionen
// (Freischalt-Kette), aktive Mission und Ziel-Fortschritt kommen vom Server
// (hello/missionEnd bzw. StateUpdate) - main.ts liefert zu, die Terminal-
// Befehle (missions/objective) lesen hier.

let wonMissionIds: string[] = [];

export function setWonMissions(ids: string[]): void {
  wonMissionIds = ids;
}

export function getWonMissions(): string[] {
  return wonMissionIds;
}

let activeMissionId: string | null = null;

export function setActiveMission(missionId: string | null): void {
  activeMissionId = missionId;
}

export function getActiveMission(): string | null {
  return activeMissionId;
}

let objectiveProgress: { done: number; total: number } | null = null;

export function setObjectiveProgress(progress: { done: number; total: number } | null): void {
  objectiveProgress = progress;
}

export function getObjectiveProgress(): { done: number; total: number } | null {
  return objectiveProgress;
}

// Ressourcenstand (Wirtschaft, PLAN.md Session B): kommt pro Tick im
// StateUpdate - main.ts liefert zu, der resources-Terminalbefehl liest hier.
let resources: ResourceAmount | null = null;

export function setResources(amount: ResourceAmount): void {
  resources = amount;
}

export function getResources(): ResourceAmount | null {
  return resources;
}

/** false, wenn noch keine Verbindung hinterlegt ist - Befehle melden das als Fehler. */
export function sendGameCommand(command: ClientCommand): boolean {
  if (!sendFn) return false;
  sendFn(command);
  return true;
}

// Auswahl-Zugriff fuer Terminal-Befehle (docs/KONZEPT.md Abschnitt 5.3:
// "select" als Terminal-Ergaenzung zur Klick-Auswahl). main.ts bindet die
// echte Auswahl (selectedUnitIds) und den letzten Server-Snapshot hier an;
// die Befehle validieren selbst (nur existierende Spieler-Einheiten).
export interface SelectionApi {
  /** Alle Einheiten aus dem letzten Server-Snapshot (leer vor dem ersten Update). */
  getUnits(): EntitySnapshot[];
  /** Alle Gebaeude aus dem letzten Server-Snapshot (immer komplett, siehe protocol.ts). */
  getBuildings(): BuildingSnapshot[];
  getSelection(): EntityId[];
  /** Ersetzt die Auswahl komplett. */
  setSelection(ids: EntityId[]): void;
}

let selectionApi: SelectionApi | null = null;

export function bindSelection(api: SelectionApi): void {
  selectionApi = api;
}

/** null, solange main.ts die Auswahl noch nicht angebunden hat. */
export function getSelectionApi(): SelectionApi | null {
  return selectionApi;
}

// Hacking-Minispiel (docs/KONZEPT.md Abschnitt 9, Phase 3): die hack-
// Antworten des Servers (Challenge/Ergebnis) kommen asynchron ueber den
// WebSocket in main.ts an, gehoeren aber in den hack-Befehl (terminal/
// commands/hack.ts) - gleiche Bruecken-Idee wie sendGameCommand, nur in
// Gegenrichtung: hack.ts registriert den Handler, main.ts liefert zu.
export type HackServerMessage = HackChallengeMessage | HackResultMessage;

let hackMessageHandler: ((message: HackServerMessage) => void) | null = null;

export function onHackMessage(handler: (message: HackServerMessage) => void): void {
  hackMessageHandler = handler;
}

export function deliverHackMessage(message: HackServerMessage): void {
  hackMessageHandler?.(message);
}

// Aufklaerungs-Sweep (docs/KONZEPT.md Abschnitt 6): reconResult ist die
// direkte Server-Antwort an den Anforderer - gleiche Bruecken-Idee wie beim
// Hacking, nur ohne mehrstufigen Dialog.
let reconResultHandler: ((message: ReconResultMessage) => void) | null = null;

export function onReconResult(handler: (message: ReconResultMessage) => void): void {
  reconResultHandler = handler;
}

export function deliverReconResult(message: ReconResultMessage): void {
  reconResultHandler?.(message);
}
