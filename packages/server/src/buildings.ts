import {
  BUILDINGS,
  CAPTURE_RANGE,
  CAPTURE_TIME_MS,
  FACTORY_PRODUCE_CAP,
  FACTORY_PRODUCE_INTERVAL_MS,
  TICK_INTERVAL_MS,
  TOWER_WEAPON,
  isWalkable,
  type BuildingFaction,
  type BuildingSnapshot,
  type BuildingType,
  type Faction,
  type GridPoint,
  type ShotEvent,
  type WalkabilityGrids,
} from '@bum-bum-taktik/shared';
import type { UnitState } from './gameLoop.js';

// Gebaeude & Basen (Aufgabe 5): statische Gebaeude auf Landkacheln, pro
// Kartenwechsel neu platziert (initBuildings). Vier Rollen:
//  - zerstoerbar: Einheiten koennen Gebaeude explizit angreifen (gameLoop.ts
//    behandelt attackTargetId auch als Gebaeude-ID)
//  - einnehmbar: Infanterie in CAPTURE_RANGE nimmt Fabriken/Staedte ein
//  - Sicht: Spieler-Gebaeude sind Fog-of-War-Sichtquellen (visibility.ts)
//  - Produktion: Fabriken spawnen Infanterie ihrer Fraktion (ueber den
//    spawnInfantry-Callback, verdrahtet in index.ts - kein Runtime-Import
//    von gameLoop.ts, damit kein Import-Zyklus entsteht)

export interface BuildingState {
  id: string;
  buildingType: BuildingType;
  faction: BuildingFaction;
  tile: GridPoint;
  x: number;
  y: number;
  hp: number;
  /** Restliche Feuerpause des Wachturms in ms. */
  cooldownMs: number;
  /** Fraktion, die gerade einnimmt (null = keine laufende Einnahme). */
  captureBy: Faction | null;
  captureProgressMs: number;
  /** Fabrik: bisher produzierte Einheiten (Cap FACTORY_PRODUCE_CAP). */
  produced: number;
  produceCooldownMs: number;
}

let buildings: BuildingState[] = [];

// Kachel -> Weltkoordinaten (Kachelmitte), gleiche Umrechnung wie
// gridToWorld in gameLoop.ts (Weltursprung = Kartenmitte).
function tileCenterWorld(tile: GridPoint, grids: WalkabilityGrids): { x: number; y: number } {
  return {
    x: tile.x - grids.width / 2 + 0.5,
    y: tile.y - grids.height / 2 + 0.5,
  };
}

// Ring-Suche nach einer freien Landkachel um "center" (wie findSpawnTile in
// gameLoop.ts, aber mit beliebigem Suchzentrum). Gibt bei Erfolg die Kachel
// zurueck und traegt sie in "occupied" ein. isValid bekommt Weltkoordinaten
// (Abstandspruefungen) UND die Kachel (z. B. Wasser-Nachbar-Check des Hafens).
function findLandTile(
  grids: WalkabilityGrids,
  center: GridPoint,
  minRadius: number,
  occupied: Set<string>,
  isValid: (world: { x: number; y: number }, tile: GridPoint) => boolean = () => true,
): GridPoint | null {
  const maxRadius = Math.max(grids.width, grids.height);
  for (let radius = minRadius; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        const key = `${x},${y}`;
        if (occupied.has(key) || !isWalkable(grids, 'land', x, y)) continue;
        if (!isValid(tileCenterWorld({ x, y }, grids), { x, y })) continue;
        occupied.add(key);
        return { x, y };
      }
    }
  }
  return null;
}

function createBuilding(id: string, buildingType: BuildingType, faction: BuildingFaction, tile: GridPoint, grids: WalkabilityGrids): BuildingState {
  const world = tileCenterWorld(tile, grids);
  return {
    id,
    buildingType,
    faction,
    tile,
    x: world.x,
    y: world.y,
    hp: BUILDINGS[buildingType].maxHp,
    cooldownMs: 0,
    captureBy: null,
    captureProgressMs: 0,
    produced: 0,
    produceCooldownMs: FACTORY_PRODUCE_INTERVAL_MS,
  };
}

// Platziert die feste Gebaeude-Aufstellung: Spieler-HQ + Fabrik nahe der
// Kartenmitte (dort spawnen auch die Spieler-Einheiten), Feind-HQ + Fabrik
// + zwei Wachtuerme weit weg, drei neutrale Staedte dazwischen verteilt.
// Auf Karten mit wenig Land (Preset "meer") kann eine Platzierung scheitern
// (findLandTile liefert null) - das Gebaeude entfaellt dann einfach, statt
// den Serverstart zu crashen.
export function initBuildings(grids: WalkabilityGrids): void {
  buildings = [];
  const occupied = new Set<string>();
  const center: GridPoint = { x: Math.floor(grids.width / 2), y: Math.floor(grids.height / 2) };

  function place(id: string, buildingType: BuildingType, faction: BuildingFaction, searchCenter: GridPoint, minRadius: number, isValid?: (world: { x: number; y: number }, tile: GridPoint) => boolean): BuildingState | null {
    // Erst mit allen Bedingungen suchen, bei Fehlschlag schrittweise lockern
    // (kleinerer Mindestradius, dann ohne Zusatzfilter).
    const tile =
      findLandTile(grids, searchCenter, minRadius, occupied, isValid) ??
      findLandTile(grids, searchCenter, 0, occupied, isValid) ??
      findLandTile(grids, searchCenter, 0, occupied);
    if (!tile) return null;
    const building = createBuilding(id, buildingType, faction, tile, grids);
    buildings.push(building);
    return building;
  }

  // Spieler-Basis: Mindestradius 3, damit HQ/Fabrik nicht exakt auf den
  // Einheiten-Spawnkacheln der Kartenmitte stehen.
  const playerHq = place('hq-player', 'hq', 'player', center, 3);
  if (playerHq) place('factory-player', 'factory', 'player', playerHq.tile, 2);

  // Feind-Basis: echten Mindestabstand zum Spieler-HQ verlangen (Ring-Radius
  // von der Mitte allein garantiert das auf Insel-Karten nicht, gleiche
  // Begruendung wie minDistanceFromPlayers in gameLoop.ts).
  const farFromPlayerHq = playerHq
    ? (world: { x: number; y: number }) => Math.hypot(world.x - playerHq.x, world.y - playerHq.y) >= 25
    : undefined;
  const enemyHq = place('hq-enemy', 'hq', 'enemy', center, 30, farFromPlayerHq);
  if (enemyHq) {
    place('factory-enemy', 'factory', 'enemy', enemyHq.tile, 2);
    place('tower-1', 'tower', 'enemy', enemyHq.tile, 3);
    place('tower-2', 'tower', 'enemy', enemyHq.tile, 3);
  }

  // Mindestabstand zu allen bereits platzierten Gebaeuden (Weltkoordinaten):
  // die occupied-Menge blockt nur die exakte Kachel, aber die Modelle sind
  // mehrere Kacheln gross - ohne Abstand stuenden z. B. Flugplatz und Stadt
  // ineinander. place() lockert den Filter bei Platzmangel selbst.
  const farFromBuildings = (world: { x: number; y: number }): boolean =>
    buildings.every((building) => Math.hypot(world.x - building.x, world.y - building.y) >= 6);

  // Neutrale Staedte: drei Suchzentren im Ring (Radius 18) um die Kartenmitte
  // in verschiedene Richtungen, damit sie nicht alle nebeneinander liegen.
  for (let i = 0; i < 3; i++) {
    const angle = (Math.PI * 2 * i) / 3 + Math.PI / 6;
    const searchCenter: GridPoint = {
      x: center.x + Math.round(Math.cos(angle) * 18),
      y: center.y + Math.round(Math.sin(angle) * 18),
    };
    place(`city-${i + 1}`, 'city', 'neutral', searchCenter, 0, farFromBuildings);
  }

  // Wirtschafts-POIs (PLAN.md Session B): alle neutral, verteilt wie die
  // Staedte in verschiedene Richtungen/Radien, damit man fuer jede Ressource
  // bzw. Produktionsstaette ein Stueck Karte kontrollieren muss.
  function poiCenter(angle: number, radius: number): GridPoint {
    return {
      x: center.x + Math.round(Math.cos(angle) * radius),
      y: center.y + Math.round(Math.sin(angle) * radius),
    };
  }
  place('mine-1', 'mine', 'neutral', poiCenter(Math.PI * 0.9, 14), 0, farFromBuildings);
  place('mine-2', 'mine', 'neutral', poiCenter(Math.PI * 1.9, 26), 0, farFromBuildings);
  place('barracks-1', 'barracks', 'neutral', poiCenter(Math.PI * 0.4, 12), 0, farFromBuildings);
  place('airfield-1', 'airfield', 'neutral', poiCenter(Math.PI * 1.4, 22), 0, farFromBuildings);

  // Hafen: braucht eine Landkachel mit direktem Wasser-Nachbar, sonst kann er
  // spaeter keine Boote produzieren. BEWUSST ohne den Lockerungs-Fallback von
  // place(): auf (fast) wasserlosen Karten (Wueste/Gebirge) entfaellt der
  // Hafen lieber ganz, statt sinnlos im Landesinneren zu stehen.
  const nearWater = (world: { x: number; y: number }, tile: GridPoint): boolean =>
    farFromBuildings(world) &&
    (isWalkable(grids, 'water', tile.x + 1, tile.y) ||
      isWalkable(grids, 'water', tile.x - 1, tile.y) ||
      isWalkable(grids, 'water', tile.x, tile.y + 1) ||
      isWalkable(grids, 'water', tile.x, tile.y - 1));
  const harborTile =
    findLandTile(grids, poiCenter(Math.PI * 0.65, 20), 0, occupied, nearWater) ??
    findLandTile(grids, center, 0, occupied, nearWater);
  if (harborTile) buildings.push(createBuilding('harbor-1', 'harbor', 'neutral', harborTile, grids));
}

export function getBuildings(): BuildingState[] {
  return buildings;
}

export function findBuilding(id: string): BuildingState | undefined {
  return buildings.find((building) => building.id === id);
}

// Einnahme-Logik pro Tick: Infanterie einer fremden Fraktion in
// CAPTURE_RANGE fuellt den Fortschritt (Anzahl egal - ein Soldat reicht),
// beide Fraktionen gleichzeitig = umkaempft = Pause, niemand da = Zerfall.
function updateCapture(building: BuildingState, units: UnitState[]): void {
  if (!BUILDINGS[building.buildingType].capturable) return;

  const present = new Set<Faction>();
  for (const unit of units) {
    if (unit.unitType !== 'infantry' || unit.embarkedInId || unit.stunnedMs > 0) continue;
    if (unit.faction === building.faction) continue;
    if (Math.hypot(unit.x - building.x, unit.y - building.y) <= CAPTURE_RANGE) present.add(unit.faction);
  }

  if (present.size === 1) {
    const faction = present.values().next().value as Faction;
    // Fraktionswechsel des Eroberers setzt fremden Teilfortschritt zurueck.
    if (building.captureBy !== faction) {
      building.captureBy = faction;
      building.captureProgressMs = 0;
    }
    building.captureProgressMs += TICK_INTERVAL_MS;
    if (building.captureProgressMs >= CAPTURE_TIME_MS) {
      building.faction = faction;
      building.captureBy = null;
      building.captureProgressMs = 0;
      // Eine eroberte Fabrik produziert fuer den neuen Besitzer von vorn.
      building.produced = 0;
      building.produceCooldownMs = FACTORY_PRODUCE_INTERVAL_MS;
    }
  } else if (present.size === 0 && building.captureBy) {
    building.captureProgressMs -= TICK_INTERVAL_MS;
    if (building.captureProgressMs <= 0) {
      building.captureBy = null;
      building.captureProgressMs = 0;
    }
  }
  // present.size === 2: umkaempft, Fortschritt friert ein.
}

// Wachturm-Feuer: naechste Einheit der Gegenseite in Reichweite, Schaden
// sofort (Tuerme feuern nicht "gleichzeitig" wie Einheiten in resolveShots -
// sie koennen nicht zurueckerschossen werden, bevor sie sterben, weil
// Gebaeude-Schaden erst im naechsten advanceUnits-Aufruf faellt).
function fireTower(building: BuildingState, units: UnitState[]): ShotEvent | null {
  building.cooldownMs = Math.max(0, building.cooldownMs - TICK_INTERVAL_MS);
  if (building.cooldownMs > 0 || building.faction === 'neutral') return null;

  let nearest: UnitState | null = null;
  let nearestDistance = Infinity;
  for (const unit of units) {
    if (unit.faction === building.faction || unit.embarkedInId) continue;
    const distance = Math.hypot(unit.x - building.x, unit.y - building.y);
    if (distance <= TOWER_WEAPON.range && distance < nearestDistance) {
      nearest = unit;
      nearestDistance = distance;
    }
  }
  if (!nearest) return null;

  building.cooldownMs = TOWER_WEAPON.cooldownMs;
  nearest.hp -= TOWER_WEAPON.damage;
  return {
    attackerId: building.id,
    targetId: nearest.id,
    fromX: building.x,
    fromY: building.y,
    toX: nearest.x,
    toY: nearest.y,
    projectile: TOWER_WEAPON.projectile,
  };
}

/**
 * Ein Gebaeude-Tick: zerstoerte Gebaeude entfernen (und Angriffsbefehle
 * darauf loeschen), Einnahmen fortschreiben, Fabriken produzieren lassen,
 * Wachtuerme feuern lassen. Gibt die Turm-Schuesse fuer die Tracer zurueck.
 */
export function updateBuildings(units: UnitState[], spawnInfantry: (faction: Faction, near: GridPoint) => boolean): ShotEvent[] {
  const destroyed = new Set(buildings.filter((building) => building.hp <= 0).map((building) => building.id));
  if (destroyed.size > 0) {
    buildings = buildings.filter((building) => !destroyed.has(building.id));
    for (const unit of units) {
      if (unit.attackTargetId && destroyed.has(unit.attackTargetId)) {
        unit.attackTargetId = null;
        unit.attackGoal = null;
        unit.path = [];
      }
    }
  }

  const shots: ShotEvent[] = [];
  for (const building of buildings) {
    updateCapture(building, units);

    if (building.buildingType === 'factory' && building.faction !== 'neutral' && building.produced < FACTORY_PRODUCE_CAP) {
      building.produceCooldownMs -= TICK_INTERVAL_MS;
      if (building.produceCooldownMs <= 0 && spawnInfantry(building.faction, building.tile)) {
        building.produced += 1;
        building.produceCooldownMs = FACTORY_PRODUCE_INTERVAL_MS;
      }
    }

    if (building.buildingType === 'tower') {
      const shot = fireTower(building, units);
      if (shot) shots.push(shot);
    }
  }
  return shots;
}

export function buildingSnapshots(): BuildingSnapshot[] {
  return buildings.map((building) => ({
    id: building.id,
    buildingType: building.buildingType,
    faction: building.faction,
    x: building.x,
    y: building.y,
    hp: building.hp,
    ...(building.captureBy
      ? { captureProgress: building.captureProgressMs / CAPTURE_TIME_MS, captureBy: building.captureBy }
      : {}),
  }));
}
