import type { Faction, UnitType } from './types.js';
import type { MapPresetId } from './procgen/presets.js';

// Missionen (docs/PLAN.md Session A, Aufgabe 4): eine Mission gehoert zu
// einer Region (= Map-Preset) und beschreibt Startaufstellung, Missionsziel
// und Briefing. Die Missionen einer Region bilden eine Kette (Array-
// Reihenfolge): die erste ist frei, jede weitere schaltet der Sieg ihrer
// Vorgaengerin frei. Welche Siege es gibt, haelt der Server im Speicher
// (Persistenz kommt in Session C).

export interface MissionUnitSetup {
  unitType: UnitType;
  faction: Faction;
  count: number;
}

// Missionsziele: Sieg, sobald das Ziel erreicht ist. Niederlage fuer alle
// Zieltypen, wenn alle eigenen Einheiten fallen ODER das eigene HQ faellt
// (Pruefung in server/index.ts).
export type MissionObjective =
  | { kind: 'eliminateAll' }
  | { kind: 'destroyHQ' }
  | { kind: 'captureCities'; count: number };

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  region: MapPresetId;
  setup: MissionUnitSetup[];
  objective: MissionObjective;
  /** Wird beim Missionsstart im Terminal ausgegeben. */
  briefing: string;
}

// Kurzbeschreibung des Ziels fuer Terminal-Ausgaben (Briefing, objective-
// Befehl) - zentral hier, damit Client und Server denselben Text nutzen.
export function describeObjective(objective: MissionObjective): string {
  switch (objective.kind) {
    case 'eliminateAll':
      return 'Alle Feindeinheiten zerstoeren.';
    case 'destroyHQ':
      return 'Das feindliche Hauptquartier zerstoeren.';
    case 'captureCities':
      return `${objective.count} Staedte einnehmen.`;
  }
}

export const MISSIONS: MissionDef[] = [
  // --- Region Plains: Einstiegs-Kette ---
  {
    id: 'erstkontakt',
    name: 'Erstkontakt',
    description: 'Eine kleine Vorhut trifft auf feindliche Aufklaerer.',
    region: 'plains',
    objective: { kind: 'eliminateAll' },
    briefing:
      'Feindliche Aufklaerer sind in unserem Sektor gelandet. Sichere das Umland und zerstoere alle Feindeinheiten, bevor Verstaerkung eintrifft.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 1 },
      { unitType: 'infantry', faction: 'player', count: 1 },
      { unitType: 'boat', faction: 'player', count: 1 },
      { unitType: 'plane', faction: 'player', count: 1 },
      { unitType: 'tank', faction: 'enemy', count: 1 },
      { unitType: 'infantry', faction: 'enemy', count: 1 },
    ],
  },
  {
    id: 'landnahme',
    name: 'Landnahme',
    description: 'Die Staedte der Ebene brauchen Schutz - wer sie haelt, haelt die Region.',
    region: 'plains',
    objective: { kind: 'captureCities', count: 2 },
    briefing:
      'Die neutralen Staedte der Ebene duerfen nicht an den Feind fallen. Rueck mit Infanterie vor und nimm zwei Staedte ein - Panzer geben Deckung.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 2 },
      { unitType: 'infantry', faction: 'player', count: 3 },
      { unitType: 'tank', faction: 'enemy', count: 2 },
      { unitType: 'infantry', faction: 'enemy', count: 2 },
    ],
  },
  {
    id: 'gegenschlag',
    name: 'Gegenschlag',
    description: 'Zeit fuer die Offensive: das Feind-HQ in der Ebene muss fallen.',
    region: 'plains',
    objective: { kind: 'destroyHQ' },
    briefing:
      'Der Feind hat sich eingegraben - sein Hauptquartier wird von Wachtuermen gedeckt. Fuehre den Angriff und mach das HQ dem Erdboden gleich.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 2 },
      { unitType: 'infantry', faction: 'player', count: 2 },
      { unitType: 'plane', faction: 'player', count: 1 },
      { unitType: 'tank', faction: 'enemy', count: 3 },
      { unitType: 'infantry', faction: 'enemy', count: 3 },
    ],
  },

  // --- Region Wueste ---
  {
    id: 'oase-sichern',
    name: 'Oase sichern',
    description: 'Panzervorstoss durch den Sand gegen verschanzte Verteidiger.',
    region: 'wueste',
    objective: { kind: 'eliminateAll' },
    briefing:
      'Die Oase ist der einzige Wasserpunkt weit und breit. Verschanzte Verteidiger halten sie besetzt - raeum sie vollstaendig aus.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 2 },
      { unitType: 'infantry', faction: 'player', count: 3 },
      { unitType: 'tank', faction: 'enemy', count: 2 },
      { unitType: 'infantry', faction: 'enemy', count: 2 },
    ],
  },
  {
    id: 'sandsturm',
    name: 'Sandsturm',
    description: 'Grossangriff auf die Wuestenfestung des Feindes.',
    region: 'wueste',
    objective: { kind: 'destroyHQ' },
    briefing:
      'Hinter den Duenen liegt die Festung des Feindes. Seine Panzerverbaende sind zahlreich - brich durch und zerstoere das Hauptquartier.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 3 },
      { unitType: 'infantry', faction: 'player', count: 2 },
      { unitType: 'tank', faction: 'enemy', count: 3 },
      { unitType: 'infantry', faction: 'enemy', count: 3 },
    ],
  },

  // --- Region Gebirge ---
  {
    id: 'passkontrolle',
    name: 'Passkontrolle',
    description: 'Infanteriegefecht um einen Gebirgspass - Fahrzeuge kommen hier nicht durch.',
    region: 'gebirge',
    objective: { kind: 'eliminateAll' },
    briefing:
      'Der Pass ist zu steil fuer Fahrzeuge - das hier entscheiden die Stiefel. Wirf die feindliche Infanterie vom Berg.',
    setup: [
      { unitType: 'infantry', faction: 'player', count: 4 },
      { unitType: 'infantry', faction: 'enemy', count: 3 },
    ],
  },
  {
    id: 'hoehenweg',
    name: 'Hoehenweg',
    description: 'Die Bergdoerfer kontrollieren die Nachschubwege der Region.',
    region: 'gebirge',
    objective: { kind: 'captureCities', count: 3 },
    briefing:
      'Wer die Doerfer am Hoehenweg haelt, kontrolliert den Nachschub. Nimm alle drei Staedte ein, bevor der Feind sie befestigt.',
    setup: [
      { unitType: 'infantry', faction: 'player', count: 5 },
      { unitType: 'infantry', faction: 'enemy', count: 5 },
    ],
  },

  // --- Region Meer ---
  {
    id: 'brueckenkopf',
    name: 'Brueckenkopf',
    description: 'Landung auf der Nachbarinsel: die Bruecke ist der einzige Landweg.',
    region: 'meer',
    objective: { kind: 'eliminateAll' },
    briefing:
      'Die Bruecke ist der einzige Landweg auf die Nachbarinsel - entsprechend gut wird sie bewacht. Setze ueber und schlag die Verteidiger.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 1 },
      { unitType: 'infantry', faction: 'player', count: 2 },
      { unitType: 'boat', faction: 'player', count: 1 },
      { unitType: 'infantry', faction: 'enemy', count: 2 },
      { unitType: 'boat', faction: 'enemy', count: 1 },
    ],
  },
  {
    id: 'inselfestung',
    name: 'Inselfestung',
    description: 'Das Feind-HQ liegt auf der grossen Insel - nur eine Landung kann es brechen.',
    region: 'meer',
    objective: { kind: 'destroyHQ' },
    briefing:
      'Das feindliche Hauptquartier liegt hinter Wasser und Wachtuermen. Verlade die Infanterie in Boote, lande und zerstoere das HQ.',
    setup: [
      { unitType: 'tank', faction: 'player', count: 1 },
      { unitType: 'infantry', faction: 'player', count: 3 },
      { unitType: 'boat', faction: 'player', count: 2 },
      { unitType: 'tank', faction: 'enemy', count: 1 },
      { unitType: 'infantry', faction: 'enemy', count: 3 },
      { unitType: 'boat', faction: 'enemy', count: 1 },
    ],
  },
];

export function missionsForRegion(region: MapPresetId): MissionDef[] {
  return MISSIONS.filter((mission) => mission.region === region);
}

// Laufzeit-Lookup fuer missionId-Strings von aussen (startMission-Befehl).
export function getMission(missionId: string): MissionDef | undefined {
  return MISSIONS.find((mission) => mission.id === missionId);
}

// Vorgaengerin in der Regions-Kette (Array-Reihenfolge) oder null fuer die
// jeweils erste Mission einer Region.
export function previousMissionInRegion(missionId: string): MissionDef | null {
  const mission = getMission(missionId);
  if (!mission) return null;
  const chain = missionsForRegion(mission.region);
  const index = chain.findIndex((entry) => entry.id === missionId);
  return index > 0 ? (chain[index - 1] as MissionDef) : null;
}

// Freischalt-Regel der Kette - gemeinsam fuer Server (erzwingt sie beim
// startMission-Befehl) und Client ("[gesperrt]" in der Missionsliste).
export function isMissionUnlocked(missionId: string, wonMissionIds: ReadonlyArray<string>): boolean {
  const previous = previousMissionInRegion(missionId);
  return previous === null || wonMissionIds.includes(previous.id);
}
