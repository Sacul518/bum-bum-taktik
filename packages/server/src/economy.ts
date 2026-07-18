import { BUILDING_INCOME_PER_S, START_RESOURCES, type Faction, type ResourceAmount } from '@bum-bum-taktik/shared';
import type { BuildingState } from './buildings.js';

// Wirtschaft (PLAN.md Session B): ein Konto pro Fraktion, Einkommen faellt
// pro Tick anteilig an (intern als Kommazahlen, nach aussen abgerundet).
// Koop-Modus: alle Spieler teilen sich das player-Konto, die Feind-KI
// wirtschaftet auf dem enemy-Konto (ai.ts, Session-B-Aufgabe 6).

let accounts: Record<Faction, ResourceAmount> = {
  player: { ...START_RESOURCES },
  enemy: { ...START_RESOURCES },
};

/** Reset auf die Startwerte - bei jedem Kartenwechsel (switchMap). */
export function initEconomy(): void {
  accounts = {
    player: { ...START_RESOURCES },
    enemy: { ...START_RESOURCES },
  };
}

/** Laufendes Einkommen aller nicht-neutralen Gebaeude fuer dtMs anrechnen. */
export function updateEconomy(buildings: ReadonlyArray<BuildingState>, dtMs: number): void {
  for (const building of buildings) {
    if (building.faction === 'neutral') continue;
    const income = BUILDING_INCOME_PER_S[building.buildingType];
    if (!income) continue;
    const account = accounts[building.faction];
    account.credits += ((income.credits ?? 0) * dtMs) / 1000;
    account.material += ((income.material ?? 0) * dtMs) / 1000;
  }
}

/** Kontostand ganzzahlig abgerundet - so geht er auch ins StateUpdate. */
export function getResources(faction: Faction): ResourceAmount {
  const account = accounts[faction];
  return { credits: Math.floor(account.credits), material: Math.floor(account.material) };
}

/** Zieht die Kosten ab, wenn der (abgerundete) Kontostand reicht - sonst false. */
export function trySpend(faction: Faction, cost: ResourceAmount): boolean {
  const account = accounts[faction];
  if (Math.floor(account.credits) < cost.credits || Math.floor(account.material) < cost.material) return false;
  account.credits -= cost.credits;
  account.material -= cost.material;
  return true;
}
