import {
  TICK_INTERVAL_MS,
  UNIT_DOMAIN,
  findPath,
  isWalkable,
  type Domain,
  type EntitySnapshot,
  type GridPoint,
  type UnitType,
  type WalkabilityGrids,
} from '@bum-bum-taktik/shared';

// Platzhalter-Truppen fuer den Pathfinding-Smoke-Test: eine Einheit pro
// Domain-Typ (docs/KONZEPT.md Abschnitt 3). Echtes Spawn-/Basenbau-System
// kommt spaeter - hier reicht je eine Einheit, auf der man Klick-zum-Ziel
// pro Domain sichtbar testen kann.
const MOVE_SPEED_UNITS_PER_S = 8;
const ARRIVAL_EPSILON = 0.05;

interface UnitState {
  id: string;
  unitType: UnitType;
  x: number;
  y: number;
  heading: number;
  /** Verbleibende Wegpunkte in Grid-Koordinaten, naechster zuerst. */
  path: GridPoint[];
}

let units: UnitState[] = [];
let activeGrids: WalkabilityGrids | null = null;

// Server-/Welt-Koordinaten sind auf die Kartenmitte zentriert (wie
// offsetX/offsetZ beim Terrain-Rendering im Client), das Begehbarkeits-
// Raster ist dagegen 0-indiziert von der Kartenecke aus - diese beiden
// Funktionen sind die einzige Stelle, an der zwischen beiden Systemen
// umgerechnet wird.
function worldToGrid(worldX: number, worldY: number, grids: WalkabilityGrids): GridPoint {
  return {
    x: Math.floor(worldX + grids.width / 2),
    y: Math.floor(worldY + grids.height / 2),
  };
}

function gridToWorld(point: GridPoint, grids: WalkabilityGrids): { x: number; y: number } {
  return {
    x: point.x - grids.width / 2 + 0.5,
    y: point.y - grids.height / 2 + 0.5,
  };
}

// Sucht ringfoermig ausgehend von der Kartenmitte die naechste begehbare
// Kachel fuer eine Domain - Truppen sollen sichtbar nahe am Kamerastart
// (Weltursprung = Kartenmitte) spawnen, nicht irgendwo am Kartenrand.
// "occupied" haelt bereits vergebene Kacheln zurueck, damit z. B. Panzer und
// Infanterie (beide Domain "land") nicht exakt uebereinander spawnen.
function findSpawnTile(grids: WalkabilityGrids, domain: Domain, occupied: Set<string>): GridPoint {
  const centerX = Math.floor(grids.width / 2);
  const centerY = Math.floor(grids.height / 2);
  const maxRadius = Math.max(grids.width, grids.height);

  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        const key = `${x},${y}`;
        if (!occupied.has(key) && isWalkable(grids, domain, x, y)) {
          occupied.add(key);
          return { x, y };
        }
      }
    }
  }

  throw new Error(`Keine begehbare Kachel fuer Domain "${domain}" gefunden`);
}

export function initUnits(grids: WalkabilityGrids): void {
  activeGrids = grids;
  const occupied = new Set<string>();
  units = (Object.keys(UNIT_DOMAIN) as UnitType[]).map((unitType) => {
    const spawnTile = findSpawnTile(grids, UNIT_DOMAIN[unitType], occupied);
    const world = gridToWorld(spawnTile, grids);
    return { id: `${unitType}-1`, unitType, x: world.x, y: world.y, heading: 0, path: [] };
  });
}

export function setUnitTargets(unitIds: string[], targetWorldX: number, targetWorldY: number): void {
  if (!activeGrids) return;
  const grids = activeGrids;
  const goalTile = worldToGrid(targetWorldX, targetWorldY, grids);

  for (const unit of units) {
    if (!unitIds.includes(unit.id)) continue;
    const startTile = worldToGrid(unit.x, unit.y, grids);
    // findPath liefert null, wenn das Ziel in einer anderen Domain liegt
    // oder unerreichbar ist (z. B. Panzer klickt auf Wasser) - die Einheit
    // bleibt dann einfach stehen, statt einen Fehler zu werfen.
    unit.path = findPath(grids, UNIT_DOMAIN[unit.unitType], startTile, goalTile) ?? [];
  }
}

function advanceUnit(unit: UnitState, grids: WalkabilityGrids): void {
  const nextTile = unit.path[0];
  if (!nextTile) return;

  const target = gridToWorld(nextTile, grids);
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const distance = Math.hypot(dx, dy);
  const step = (MOVE_SPEED_UNITS_PER_S * TICK_INTERVAL_MS) / 1000;

  if (distance <= Math.max(step, ARRIVAL_EPSILON)) {
    unit.x = target.x;
    unit.y = target.y;
    unit.path.shift();
  } else {
    unit.heading = Math.atan2(dy, dx);
    unit.x += (dx / distance) * step;
    unit.y += (dy / distance) * step;
  }
}

export function advanceUnits(): EntitySnapshot[] {
  if (!activeGrids) return [];
  const grids = activeGrids;
  for (const unit of units) {
    advanceUnit(unit, grids);
  }

  return units.map((unit) => ({
    id: unit.id,
    unitType: unit.unitType,
    x: unit.x,
    y: unit.y,
    heading: unit.heading,
    hp: 100,
    path: unit.path.map((tile) => gridToWorld(tile, grids)),
  }));
}
