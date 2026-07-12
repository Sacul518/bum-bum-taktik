import {
  COMBAT_STATS,
  TICK_INTERVAL_MS,
  UNIT_DOMAIN,
  findPath,
  isWalkable,
  type Domain,
  type EntitySnapshot,
  type Faction,
  type GridPoint,
  type MissionUnitSetup,
  type ShotEvent,
  type UnitType,
  type WalkabilityGrids,
} from '@bum-bum-taktik/shared';
import { updateEnemyAggro } from './ai.js';

// Ohne Mission (freie Aufstellung, docs/KONZEPT.md Abschnitt 3.2): eine
// Spieler-Einheit pro Domain-Typ plus zwei stillstehende Feind-Einheiten als
// Zielscheiben. Mit Mission: Aufstellung aus mission.setup (initUnits).
const MOVE_SPEED_UNITS_PER_S = 8;
const ARRIVAL_EPSILON = 0.05;

// Mindestabstand (Kacheln) der Feind-Spawns: muss groesser sein als
// ENEMY_AGGRO_RANGE (14, siehe ai.ts), sonst greift die Gegner-KI die
// Spieler-Einheiten schon beim Spawn an, statt dass man den Anmarsch sieht.
// Doppelt abgesichert (siehe findSpawnTile/minDistanceFromPlayers): Ring-
// Radius von der Kartenmitte UND echter Mindestabstand zu den tatsaechlich
// platzierten Spieler-Einheiten - auf Karten mit knappem, versetztem Land
// (Preset "meer") liegt die Kartenmitte selbst oft nicht auf begehbarem
// Land, dann reicht "Radius von der Mitte" allein nicht als Garantie.
const ENEMY_SPAWN_RADIUS = 20;

export interface UnitState {
  id: string;
  unitType: UnitType;
  faction: Faction;
  x: number;
  y: number;
  heading: number;
  hp: number;
  /** Restliche Feuerpause in ms; die Einheit darf bei <= 0 wieder schiessen. */
  cooldownMs: number;
  /** Restliche Hack-Lahmlegung in ms (hacking.ts); bei > 0 weder Bewegung noch Feuer. */
  stunnedMs: number;
  /** Expliziter Angriffsbefehl: Ziel-Einheit, die verfolgt und beschossen wird. */
  attackTargetId: string | null;
  /** Kachel, zu der zuletzt ein Verfolgungs-Pfad berechnet wurde - verhindert, dass jeder Tick neu geplant wird. */
  attackGoal: GridPoint | null;
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
// "isValid" ist ein optionaler Zusatzfilter (Weltkoordinaten) - noetig, weil
// "Radius von der Kartenmitte" auf Karten mit knappem, versetztem Land (z. B.
// Preset "meer": zwei kleine Inseln, nicht die Kartenmitte selbst) keine
// verlaessliche Garantie fuer den tatsaechlichen Abstand zu anderen Einheiten
// ist - siehe minDistanceFromPlayers unten.
function findSpawnTile(
  grids: WalkabilityGrids,
  domain: Domain,
  occupied: Set<string>,
  minRadius = 0,
  isValid: (world: { x: number; y: number }) => boolean = () => true,
): GridPoint {
  const centerX = Math.floor(grids.width / 2);
  const centerY = Math.floor(grids.height / 2);
  const maxRadius = Math.max(grids.width, grids.height);

  for (let radius = minRadius; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        const key = `${x},${y}`;
        if (occupied.has(key) || !isWalkable(grids, domain, x, y)) continue;
        if (!isValid(gridToWorld({ x, y }, grids))) continue;
        occupied.add(key);
        return { x, y };
      }
    }
  }

  throw new Error(`Keine begehbare Kachel fuer Domain "${domain}" gefunden`);
}

// Zusatzfilter fuer Feind-Spawns: verlangt echten Mindestabstand (Weltkoord.,
// euklidisch) zu jeder bereits platzierten Spieler-Einheit - der reine
// Ring-Radius von der Kartenmitte reicht allein nicht, siehe findSpawnTile.
function minDistanceFromPlayers(playerPositions: { x: number; y: number }[], minDistance: number) {
  return (world: { x: number; y: number }): boolean =>
    playerPositions.every((p) => Math.hypot(world.x - p.x, world.y - p.y) >= minDistance);
}

function createUnit(id: string, unitType: UnitType, faction: Faction, spawnTile: GridPoint, grids: WalkabilityGrids): UnitState {
  const world = gridToWorld(spawnTile, grids);
  return {
    id,
    unitType,
    faction,
    x: world.x,
    y: world.y,
    heading: 0,
    hp: COMBAT_STATS[unitType].maxHp,
    cooldownMs: 0,
    stunnedMs: 0,
    attackTargetId: null,
    attackGoal: null,
    path: [],
  };
}

// Fortlaufende IDs pro Fraktion+Typ (tank-1, tank-2, enemy-tank-1, ...) -
// eigene Zaehler-Map, damit mehrere Setup-Eintraege mit demselben Typ
// (kommt in den aktuellen MISSIONS nicht vor, ist aber kein Sonderfall wert)
// keine doppelten IDs erzeugen. Spieler zuerst spawnen: die Feind-Suche
// braucht deren tatsaechliche Positionen fuer minDistanceFromPlayers.
function spawnFromSetup(setup: MissionUnitSetup[], grids: WalkabilityGrids, occupied: Set<string>): UnitState[] {
  const counters = new Map<string, number>();
  const spawned: UnitState[] = [];

  function spawnEntries(faction: Faction, isValid?: (world: { x: number; y: number }) => boolean): void {
    for (const entry of setup.filter((e) => e.faction === faction)) {
      const counterKey = `${entry.faction}-${entry.unitType}`;
      for (let i = 0; i < entry.count; i++) {
        const n = (counters.get(counterKey) ?? 0) + 1;
        counters.set(counterKey, n);
        const id = entry.faction === 'enemy' ? `enemy-${entry.unitType}-${n}` : `${entry.unitType}-${n}`;
        const minRadius = entry.faction === 'enemy' ? ENEMY_SPAWN_RADIUS : 0;
        const spawnTile = findSpawnTile(grids, UNIT_DOMAIN[entry.unitType], occupied, minRadius, isValid);
        spawned.push(createUnit(id, entry.unitType, entry.faction, spawnTile, grids));
      }
    }
  }

  spawnEntries('player');
  // Schnappschuss-Kopie: "spawned" waechst in der naechsten Zeile weiter
  // (Feind-Einheiten werden angehaengt) - ohne Kopie wuerde jede weitere
  // Feind-Einheit faelschlich auch gegen bereits platzierte Feinde statt nur
  // gegen Spieler geprueft.
  spawnEntries('enemy', minDistanceFromPlayers([...spawned], ENEMY_SPAWN_RADIUS));

  return spawned;
}

export function initUnits(grids: WalkabilityGrids, setup?: MissionUnitSetup[]): void {
  activeGrids = grids;
  const occupied = new Set<string>();

  if (setup) {
    units = spawnFromSetup(setup, grids, occupied);
    return;
  }

  units = (Object.keys(UNIT_DOMAIN) as UnitType[]).map((unitType) =>
    createUnit(`${unitType}-1`, unitType, 'player', findSpawnTile(grids, UNIT_DOMAIN[unitType], occupied), grids),
  );
  // Schnappschuss-Kopie: "units" waechst gleich weiter (Feind-Einheiten
  // werden angehaengt) - ohne Kopie wuerde die zweite Feind-Einheit
  // faelschlich auch gegen die erste Feind-Einheit statt nur gegen Spieler
  // geprueft.
  const isFarFromPlayers = minDistanceFromPlayers([...units], ENEMY_SPAWN_RADIUS);
  for (const unitType of ['tank', 'infantry'] as UnitType[]) {
    units.push(
      createUnit(
        `enemy-${unitType}-1`,
        unitType,
        'enemy',
        findSpawnTile(grids, UNIT_DOMAIN[unitType], occupied, ENEMY_SPAWN_RADIUS, isFarFromPlayers),
        grids,
      ),
    );
  }
}

function findUnit(id: string): UnitState | undefined {
  return units.find((unit) => unit.id === id);
}

// Lebende Referenz auf den Einheiten-Zustand fuer Module, die ihn direkt
// mutieren (hacking.ts, wie ai.ts es ueber den advanceUnits-Parameter tut).
export function getUnits(): UnitState[] {
  return units;
}

export function setUnitTargets(unitIds: string[], targetWorldX: number, targetWorldY: number): void {
  if (!activeGrids) return;
  const grids = activeGrids;
  const goalTile = worldToGrid(targetWorldX, targetWorldY, grids);

  for (const unit of units) {
    if (!unitIds.includes(unit.id)) continue;
    // Clients steuern nur die Spieler-Fraktion; Befehle an Feind-Einheiten
    // (z. B. durch Anklicken eines Feindes) werden ignoriert.
    if (unit.faction !== 'player') continue;
    // Ein Bewegungsbefehl ueberschreibt einen laufenden Angriffsbefehl.
    unit.attackTargetId = null;
    unit.attackGoal = null;
    const startTile = worldToGrid(unit.x, unit.y, grids);
    // findPath liefert null, wenn das Ziel in einer anderen Domain liegt
    // oder unerreichbar ist (z. B. Panzer klickt auf Wasser) - die Einheit
    // bleibt dann einfach stehen, statt einen Fehler zu werfen.
    unit.path = findPath(grids, UNIT_DOMAIN[unit.unitType], startTile, goalTile) ?? [];
  }
}

export function setAttackTarget(unitId: string, targetId: string): void {
  const attacker = findUnit(unitId);
  const target = findUnit(targetId);
  // Clients befehligen nur die Spieler-Fraktion, und kein Friendly Fire:
  // Angriffsbefehle auf die eigene Fraktion werden ignoriert (Koop-Modus,
  // docs/KONZEPT.md Abschnitt 0).
  if (!attacker || !target || attacker.faction !== 'player' || target.faction === 'player') return;
  attacker.attackTargetId = targetId;
  attacker.attackGoal = null;
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

// Verfolgung bei explizitem Angriffsbefehl: ausserhalb der Reichweite laeuft
// die Einheit auf das Ziel zu, innerhalb bleibt sie stehen und feuert (siehe
// resolveShots). Der Pfad wird nur neu geplant, wenn sich die Ziel-Kachel
// geaendert hat - nicht jeden Tick.
function updateAttackChase(unit: UnitState, grids: WalkabilityGrids): void {
  if (!unit.attackTargetId) return;
  const target = findUnit(unit.attackTargetId);
  if (!target) {
    unit.attackTargetId = null;
    unit.attackGoal = null;
    unit.path = [];
    return;
  }

  if (Math.hypot(target.x - unit.x, target.y - unit.y) <= COMBAT_STATS[unit.unitType].range) {
    unit.path = [];
    unit.attackGoal = null;
    return;
  }

  const goalTile = worldToGrid(target.x, target.y, grids);
  if (!unit.attackGoal || unit.attackGoal.x !== goalTile.x || unit.attackGoal.y !== goalTile.y) {
    unit.attackGoal = goalTile;
    const startTile = worldToGrid(unit.x, unit.y, grids);
    unit.path = findPath(grids, UNIT_DOMAIN[unit.unitType], startTile, goalTile) ?? [];
  }
}

// Ziel-Wahl beim Feuern: ein expliziter Angriffsbefehl hat Vorrang (und gilt
// nur, wenn das Ziel schon in Reichweite ist - sonst laeuft die Verfolgung).
// Ohne Befehl: Auto-Feuer auf den naechsten Feind in Reichweite.
function selectFireTarget(unit: UnitState): UnitState | null {
  const range = COMBAT_STATS[unit.unitType].range;

  if (unit.attackTargetId) {
    const target = findUnit(unit.attackTargetId);
    if (target && Math.hypot(target.x - unit.x, target.y - unit.y) <= range) return target;
    return null;
  }

  let nearest: UnitState | null = null;
  let nearestDistance = Infinity;
  for (const other of units) {
    if (other.faction === unit.faction) continue;
    const distance = Math.hypot(other.x - unit.x, other.y - unit.y);
    if (distance <= range && distance < nearestDistance) {
      nearest = other;
      nearestDistance = distance;
    }
  }
  return nearest;
}

// Alle Schuesse eines Ticks werden erst gesammelt und der Schaden danach
// abgezogen: beide Seiten feuern "gleichzeitig", niemand stirbt, bevor er
// in demselben Tick noch zurueckschiessen konnte.
function resolveShots(): ShotEvent[] {
  const shots: ShotEvent[] = [];
  const pendingDamage: { targetId: string; damage: number }[] = [];

  for (const unit of units) {
    unit.cooldownMs = Math.max(0, unit.cooldownMs - TICK_INTERVAL_MS);
    if (unit.cooldownMs > 0) continue;
    // Gestunnte Einheiten (Hack, hacking.ts) feuern nicht - der Cooldown
    // laeuft oben trotzdem weiter ab, damit sie nach dem Stun nicht auch
    // noch eine volle Feuerpause nachholen muessen.
    if (unit.stunnedMs > 0) continue;
    const target = selectFireTarget(unit);
    if (!target) continue;

    unit.cooldownMs = COMBAT_STATS[unit.unitType].cooldownMs;
    unit.heading = Math.atan2(target.y - unit.y, target.x - unit.x);
    shots.push({ attackerId: unit.id, targetId: target.id, fromX: unit.x, fromY: unit.y, toX: target.x, toY: target.y });
    pendingDamage.push({ targetId: target.id, damage: COMBAT_STATS[unit.unitType].damage });
  }

  for (const { targetId, damage } of pendingDamage) {
    const target = findUnit(targetId);
    if (target) target.hp -= damage;
  }

  return shots;
}

function removeDeadUnits(): void {
  const dead = new Set(units.filter((unit) => unit.hp <= 0).map((unit) => unit.id));
  if (dead.size === 0) return;

  units = units.filter((unit) => unit.hp > 0);
  for (const unit of units) {
    if (unit.attackTargetId && dead.has(unit.attackTargetId)) {
      unit.attackTargetId = null;
      unit.attackGoal = null;
      unit.path = [];
    }
  }
}

export function advanceUnits(): { entities: EntitySnapshot[]; shots: ShotEvent[] } {
  if (!activeGrids) return { entities: [], shots: [] };
  const grids = activeGrids;

  updateEnemyAggro(units);

  for (const unit of units) {
    // Gestunnte Einheiten (Hack, hacking.ts) stehen still; der Stun-Timer
    // laeuft in echten ms pro Tick ab, wie cooldownMs in resolveShots.
    unit.stunnedMs = Math.max(0, unit.stunnedMs - TICK_INTERVAL_MS);
    if (unit.stunnedMs > 0) continue;
    updateAttackChase(unit, grids);
    advanceUnit(unit, grids);
  }

  const shots = resolveShots();
  removeDeadUnits();

  const entities = units.map((unit) => ({
    id: unit.id,
    unitType: unit.unitType,
    faction: unit.faction,
    x: unit.x,
    y: unit.y,
    heading: unit.heading,
    hp: unit.hp,
    path: unit.path.map((tile) => gridToWorld(tile, grids)),
    // Optionales Feld nur setzen, wenn es zutrifft (spart Snapshot-Bytes und
    // vertraegt sich mit exactOptionalPropertyTypes).
    ...(unit.stunnedMs > 0 ? { stunned: true } : {}),
  }));

  return { entities, shots };
}
