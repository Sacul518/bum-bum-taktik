import { BUILDINGS, CAPTURE_RANGE, ENEMY_AGGRO_RANGE, PRODUCTION_BUILDING, UNIT_DOMAIN, canTarget, findPath, type BuildingType, type UnitType, type WalkabilityGrids } from '@bum-bum-taktik/shared';
import type { UnitState } from './gameLoop.js';
import { worldToGrid } from './gameLoop.js';
import { getBuildings, startProduction, type BuildingState } from './buildings.js';

// Gegner-KI (docs/KONZEPT.md Abschnitt 9, Phase 2): reine Ziel-Erfassung,
// vor der Bewegung in advanceUnits aufgerufen. Die eigentliche Verfolgung und
// das Feuern uebernehmen die vorhandene updateAttackChase/selectFireTarget-
// Logik in gameLoop.ts, sobald attackTargetId gesetzt ist - hier wird nur
// entschieden, WER angegriffen wird.
//
// removeDeadUnits() setzt attackTargetId einer Einheit bereits auf null,
// sobald ihr Ziel stirbt - "ohne lebendes Angriffsziel" ist deshalb einfach
// attackTargetId === null. Einmal aggro, bleibt das Ziel bis zum Tod (kein
// Ablassen, kein Patrouillieren in dieser Ausbaustufe).
//
// Seit Session B (PLAN.md) hat der Feind zusaetzlich eine rudimentaere
// Strategie-Schicht (updateEnemyStrategy): Infanterie nimmt Gebaeude ein,
// Kampfeinheiten ohne Einheiten-Ziel belagern Spieler-Gebaeude, und freie
// Produktionsgebaeude bestellen Einheiten vom enemy-Ressourcenkonto.
export function updateEnemyAggro(units: UnitState[]): void {
  const unitIds = new Set(units.map((unit) => unit.id));

  for (const unit of units) {
    if (unit.faction !== 'enemy') continue;
    // Ein Einheiten-Ziel bleibt bestehen; ein Gebaeude-Ziel (Strategie-
    // Schicht) darf dagegen von einer nahen Spieler-Einheit verdraengt
    // werden - sonst liesse sich ein belagernder Panzer gefahrlos abschiessen.
    if (unit.attackTargetId && unitIds.has(unit.attackTargetId)) continue;

    let nearest: UnitState | null = null;
    let nearestDistance = Infinity;
    for (const other of units) {
      if (other.faction !== 'player') continue;
      // Eingestiegene Einheiten sitzen unsichtbar im Transport - kein Ziel.
      if (other.embarkedInId) continue;
      // Nur Ziele erfassen, die die eigene Waffe treffen kann (WEAPONS.targets) -
      // ein Feind-Panzer soll nicht ewig einem Flugzeug hinterherfahren.
      if (!canTarget(unit.unitType, other.unitType)) continue;
      const distance = Math.hypot(other.x - unit.x, other.y - unit.y);
      if (distance <= ENEMY_AGGRO_RANGE && distance < nearestDistance) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    if (nearest) {
      unit.attackTargetId = nearest.id;
      unit.attackGoal = null;
    }
  }
}

// Strategie nur alle paar Sekunden statt pro Tick: Pathfinding und
// Zielsuche ueber alle Gebaeude sind zu teuer fuer 12 Hz, und ein
// "Nachdenk-Rhythmus" reicht fuer rudimentaeres Verhalten voellig.
const STRATEGY_INTERVAL_MS = 2000;
let strategyCooldownMs = 0;

// Obergrenze fuer die Feind-Armee: verhindert, dass eine unbehelligte
// Feind-Wirtschaft die Karte flutet (gleiche Begruendung wie frueher
// FACTORY_PRODUCE_CAP).
const ENEMY_UNIT_CAP = 16;

// Was ein Produktionsgebaeude fuer den Feind baut (Umkehrung von
// PRODUCTION_BUILDING in shared/constants.ts).
const ENEMY_BUILD_CHOICE: Partial<Record<BuildingType, UnitType>> = {};
for (const [unitType, buildingType] of Object.entries(PRODUCTION_BUILDING) as [UnitType, BuildingType][]) {
  ENEMY_BUILD_CHOICE[buildingType] = unitType;
}

function nearestBuilding(unit: UnitState, candidates: BuildingState[]): BuildingState | null {
  let nearest: BuildingState | null = null;
  let nearestDistance = Infinity;
  for (const building of candidates) {
    const distance = Math.hypot(building.x - unit.x, building.y - unit.y);
    if (distance < nearestDistance) {
      nearest = building;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Rudimentaere Feind-Strategie (PLAN.md Session B), alle 2 s:
 *  - Infanterie ohne Ziel marschiert zum naechsten einnehmbaren fremden
 *    Gebaeude (die Einnahme selbst passiert automatisch in buildings.ts).
 *  - Kampfeinheiten ohne Ziel greifen das naechste Spieler-Gebaeude an.
 *  - Freie Produktionsgebaeude bestellen ihre Einheit, solange das
 *    enemy-Konto reicht (economy.ts) und die Armee unterm Cap liegt.
 */
export function updateEnemyStrategy(units: UnitState[], grids: WalkabilityGrids, tickMs: number): void {
  strategyCooldownMs -= tickMs;
  if (strategyCooldownMs > 0) return;
  strategyCooldownMs = STRATEGY_INTERVAL_MS;

  const buildings = getBuildings();
  const capturable = buildings.filter((building) => BUILDINGS[building.buildingType].capturable && building.faction !== 'enemy');
  const playerBuildings = buildings.filter((building) => building.faction === 'player');

  for (const unit of units) {
    if (unit.faction !== 'enemy' || unit.embarkedInId || unit.stunnedMs > 0) continue;
    if (unit.attackTargetId || unit.path.length > 0) continue;

    if (unit.unitType === 'infantry' && capturable.length > 0) {
      // Steht die Infanterie schon an einem einnehmbaren Gebaeude, laeuft
      // die Einnahme (buildings.ts) - nicht wegschicken.
      const busyCapturing = capturable.some((building) => Math.hypot(building.x - unit.x, building.y - unit.y) <= CAPTURE_RANGE);
      if (busyCapturing) continue;
      const target = nearestBuilding(unit, capturable);
      if (!target) continue;
      const startTile = worldToGrid(unit.x, unit.y, grids);
      unit.path = findPath(grids, UNIT_DOMAIN[unit.unitType], startTile, target.tile) ?? [];
      continue;
    }

    // Kampfeinheiten (und Infanterie, wenn nichts mehr einzunehmen ist)
    // belagern das naechste Spieler-Gebaeude - Verfolgung/Feuer uebernimmt
    // die bestehende Angriffslogik, Spieler-Einheiten in Aggro-Reichweite
    // verdraengen das Gebaeude-Ziel (updateEnemyAggro).
    const target = nearestBuilding(unit, playerBuildings);
    if (target) {
      unit.attackTargetId = target.id;
      unit.attackGoal = null;
    }
  }

  // Produktion: ein Auftrag pro freiem Gebaeude; startProduction prueft
  // Kosten (enemy-Konto) und Belegung selbst.
  const enemyCount = units.filter((unit) => unit.faction === 'enemy').length;
  if (enemyCount >= ENEMY_UNIT_CAP) return;
  for (const building of buildings) {
    if (building.faction !== 'enemy' || building.production) continue;
    const choice = ENEMY_BUILD_CHOICE[building.buildingType];
    if (!choice) continue;
    startProduction('enemy', choice, building.id);
  }
}
