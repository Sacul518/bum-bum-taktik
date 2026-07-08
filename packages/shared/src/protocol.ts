import type { EntityId, EntitySnapshot, PlayerId } from './types.js';

// Server -> Client, einmalig beim Verbindungsaufbau
export interface ServerHello {
  type: 'hello';
  playerId: PlayerId;
  mapWidth: number;
  mapHeight: number;
  terrain: ArrayBuffer; // Terrain-Typ-Index pro Kachel (Uint8Array-Bytes)
  elevation: ArrayBuffer; // Hoehenwert -1..1 pro Kachel (Float32Array-Bytes)
}

// Server -> Client, pro Tick
export interface StateUpdate {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  visibleEnemyIds: EntityId[]; // Fog-of-War: nur was das Team gerade sieht
}

export type ServerMessage = ServerHello | StateUpdate;

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

export type ClientCommand = MoveCommand | AttackCommand | TerminalCommand;
