import type { Faction, UnitType } from './types.js';
import type { MapPresetId } from './procgen/presets.js';

// Missionen - Minimaldefinition (docs/KONZEPT.md Abschnitt 3.2): eine Mission
// gehoert zu einer Region (= Map-Preset) und beschreibt vorerst nur Name und
// Startaufstellung. Siegbedingungen, Belohnungen usw. kommen spaeter.

export interface MissionUnitSetup {
  unitType: UnitType;
  faction: Faction;
  count: number;
}

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  region: MapPresetId;
  setup: MissionUnitSetup[];
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'erstkontakt',
    name: 'Erstkontakt',
    description: 'Die bisherige Testaufstellung: eine Einheit pro Typ gegen zwei Zielscheiben.',
    region: 'plains',
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
    id: 'oase-sichern',
    name: 'Oase sichern',
    description: 'Panzervorstoss durch den Sand gegen verschanzte Verteidiger.',
    region: 'wueste',
    setup: [
      { unitType: 'tank', faction: 'player', count: 2 },
      { unitType: 'infantry', faction: 'player', count: 3 },
      { unitType: 'tank', faction: 'enemy', count: 2 },
      { unitType: 'infantry', faction: 'enemy', count: 2 },
    ],
  },
  {
    id: 'passkontrolle',
    name: 'Passkontrolle',
    description: 'Infanteriegefecht um einen Gebirgspass - Fahrzeuge kommen hier nicht durch.',
    region: 'gebirge',
    setup: [
      { unitType: 'infantry', faction: 'player', count: 4 },
      { unitType: 'infantry', faction: 'enemy', count: 3 },
    ],
  },
  {
    id: 'brueckenkopf',
    name: 'Brueckenkopf',
    description: 'Landung auf der Nachbarinsel: die Bruecke ist der einzige Landweg.',
    region: 'meer',
    setup: [
      { unitType: 'tank', faction: 'player', count: 1 },
      { unitType: 'infantry', faction: 'player', count: 2 },
      { unitType: 'boat', faction: 'player', count: 1 },
      { unitType: 'infantry', faction: 'enemy', count: 2 },
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
