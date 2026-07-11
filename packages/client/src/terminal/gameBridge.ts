import type { ClientCommand, MapPresetId } from '@bum-bum-taktik/shared';

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

/** false, wenn noch keine Verbindung hinterlegt ist - Befehle melden das als Fehler. */
export function sendGameCommand(command: ClientCommand): boolean {
  if (!sendFn) return false;
  sendFn(command);
  return true;
}
