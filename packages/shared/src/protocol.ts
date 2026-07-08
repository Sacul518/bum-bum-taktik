import type { EntityId, EntitySnapshot, PlayerId } from './types.js';

// Server -> Client, einmalig beim Verbindungsaufbau
export interface ServerHello {
  type: 'hello';
  playerId: PlayerId;
  mapWidth: number;
  mapHeight: number;
  terrain: ArrayBuffer; // komprimiertes Hoehen-/Domain-Raster
}

// Server -> Client, pro Tick
export interface StateUpdate {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  visibleEnemyIds: EntityId[]; // Fog-of-War: nur was das Team gerade sieht
}

export type ServerMessage = ServerHello | StateUpdate;

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

export type ClientCommand = MoveCommand | AttackCommand | TerminalCommand;
