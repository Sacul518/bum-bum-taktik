import {
  EMBARK_RANGE,
  MAX_HP,
  TICK_INTERVAL_MS,
  TRANSPORT_CAPACITY,
  UNIT_DOMAIN,
  WEAPONS,
  canTarget,
  findPath,
  isWalkable,
  weaponDamage,
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
import { findBuilding } from './buildings.js';

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
  /** Einsteige-Befehl: Transport, zu dem die Einheit laeuft (Infanterie). */
  embarkTargetId: string | null;
  /** Kachel, zu der zuletzt der Einsteige-Anlauf geplant wurde (wie attackGoal). */
  embarkGoal: GridPoint | null;
  /** Transport, in dem die Einheit gerade sitzt - dann weder sichtbar noch aktiv. */
  embarkedInId: string | null;
  /** IDs der aktuell eingestiegenen Einheiten (nur Transporter). */
  passengerIds: string[];
  /** Verbleibende Wegpunkte in Grid-Koordinaten, naechster zuerst. */
  path: GridPoint[];
}

let units: UnitState[] = [];
let activeGrids: WalkabilityGrids | null = null;

// Fortlaufender Zaehler fuer fabrik-produzierte Einheiten (spawnProducedUnit),
// Reset bei jedem Kartenwechsel (initUnits). Eigener "p"-Namensraum
// (infantry-p1, enemy-infantry-p2, ...), damit die IDs nie mit den
// Start-Aufstellungs-IDs (infantry-1, ...) kollidieren.
let producedCounter = 0;

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
    hp: MAX_HP[unitType],
    cooldownMs: 0,
    stunnedMs: 0,
    attackTargetId: null,
    attackGoal: null,
    embarkTargetId: null,
    embarkGoal: null,
    embarkedInId: null,
    passengerIds: [],
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
  producedCounter = 0;
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
    // Eingestiegene Einheiten koennen sich nicht selbst bewegen - erst
    // aussteigen (disembark).
    if (unit.embarkedInId) continue;
    // Ein Bewegungsbefehl ueberschreibt laufende Angriffs-/Einsteige-Befehle.
    unit.attackTargetId = null;
    unit.attackGoal = null;
    unit.embarkTargetId = null;
    unit.embarkGoal = null;
    const startTile = worldToGrid(unit.x, unit.y, grids);
    // findPath liefert null, wenn das Ziel in einer anderen Domain liegt
    // oder unerreichbar ist (z. B. Panzer klickt auf Wasser) - die Einheit
    // bleibt dann einfach stehen, statt einen Fehler zu werfen.
    unit.path = findPath(grids, UNIT_DOMAIN[unit.unitType], startTile, goalTile) ?? [];
  }
}

export function setAttackTarget(unitId: string, targetId: string): void {
  const attacker = findUnit(unitId);
  if (!attacker || attacker.faction !== 'player' || attacker.embarkedInId) return;

  const target = findUnit(targetId);
  if (!target) {
    // Kein Einheiten-Ziel: vielleicht ein Gebaeude (buildings.ts). Feindliche
    // und neutrale Gebaeude sind angreifbar; sie zaehlen als Land-Ziel, also
    // muss die Waffe des Angreifers die Land-Domain treffen koennen.
    const building = findBuilding(targetId);
    if (!building || building.faction === 'player') return;
    if (!WEAPONS[attacker.unitType].targets.includes('land')) return;
    attacker.attackTargetId = targetId;
    attacker.attackGoal = null;
    attacker.embarkTargetId = null;
    attacker.embarkGoal = null;
    return;
  }

  // Clients befehligen nur die Spieler-Fraktion, und kein Friendly Fire:
  // Angriffsbefehle auf die eigene Fraktion werden ignoriert (Koop-Modus,
  // docs/KONZEPT.md Abschnitt 0).
  if (target.faction === 'player') return;
  // Ziele ausserhalb der Waffen-Domains ablehnen (Panzer vs. Flugzeug) -
  // sonst wuerde die Einheit ewig verfolgen, ohne je feuern zu koennen.
  if (!canTarget(attacker.unitType, target.unitType)) return;
  // Eingestiegene Ziele sind unsichtbar und nicht anvisierbar.
  if (target.embarkedInId) return;
  attacker.attackTargetId = targetId;
  attacker.attackGoal = null;
  attacker.embarkTargetId = null;
  attacker.embarkGoal = null;
}

/**
 * Produktion (buildings.ts): spawnt die fertige Einheit auf der naechsten
 * fuer ihre Domain begehbaren Kachel neben dem Gebaeude - beim Hafen ist das
 * die Wasserkachel nebenan, beim Flugplatz die eigene Kachel (Luft ist ueberall
 * frei). false, wenn gerade keine passende Kachel in der Naehe ist - das
 * Gebaeude versucht es dann im naechsten Tick erneut.
 */
export function spawnProducedUnit(faction: Faction, unitType: UnitType, near: GridPoint): boolean {
  if (!activeGrids) return false;
  // minRadius 1: nicht auf der Gebaeudekachel selbst spawnen - die Modelle
  // sind mehrere Kacheln gross, die Einheit stuende sonst mitten im Gebaeude.
  const tile = nearestWalkableTile(activeGrids, UNIT_DOMAIN[unitType], near, 4, 1);
  if (!tile) return false;
  producedCounter += 1;
  const id = faction === 'enemy' ? `enemy-${unitType}-p${producedCounter}` : `${unitType}-p${producedCounter}`;
  units.push(createUnit(id, unitType, faction, tile, activeGrids));
  return true;
}

// --- Transport: Ein-/Aussteigen (Aufgabe "Infanterie-/Fahrzeug-Interaktion") ---

// Naechste fuer die Domain begehbare Kachel um "center" (Ring-Suche wie
// findSpawnTile, aber klein und ohne occupied-Logik). Noetig, weil die
// Kachel eines Boots (Wasser) fuer Infanterie (Land) nie begehbar ist -
// als Anlauf-/Absetzziel dient die naechstgelegene Landkachel daneben.
function nearestWalkableTile(grids: WalkabilityGrids, domain: Domain, center: GridPoint, maxRadius: number, minRadius = 0): GridPoint | null {
  for (let radius = minRadius; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        if (isWalkable(grids, domain, x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Einsteige-Befehl: die Einheiten laufen zum Transport und steigen bei Ankunft ein (updateEmbarkChase). */
export function orderEmbark(unitIds: string[], transportId: string): void {
  const transport = findUnit(transportId);
  if (!transport || transport.faction !== 'player' || transport.embarkedInId) return;
  if (TRANSPORT_CAPACITY[transport.unitType] === 0) return;

  for (const unitId of unitIds) {
    const unit = findUnit(unitId);
    // Nur eigene Infanterie kann einsteigen; Transporter selbst und bereits
    // Eingestiegene nicht.
    if (!unit || unit.faction !== 'player' || unit.unitType !== 'infantry') continue;
    if (unit.id === transportId || unit.embarkedInId) continue;
    unit.embarkTargetId = transportId;
    unit.embarkGoal = null;
    unit.attackTargetId = null;
    unit.attackGoal = null;
    unit.path = [];
  }
}

/** Setzt alle Passagiere auf begehbare Kacheln neben dem Transport ab (wer keinen Platz findet, bleibt drin). */
export function orderDisembark(transportId: string): void {
  if (!activeGrids) return;
  const grids = activeGrids;
  const transport = findUnit(transportId);
  if (!transport || transport.faction !== 'player' || transport.passengerIds.length === 0) return;

  const transportTile = worldToGrid(transport.x, transport.y, grids);
  const remaining: string[] = [];
  const taken = new Set<string>();

  for (const passengerId of transport.passengerIds) {
    const passenger = findUnit(passengerId);
    if (!passenger) continue;
    // Pro Passagier eine eigene Kachel (taken), damit sie nicht alle exakt
    // uebereinander landen; Radius 3 reicht fuer 4 Passagiere locker.
    const tile = nearestFreeWalkableTile(grids, UNIT_DOMAIN[passenger.unitType], transportTile, 3, taken);
    if (!tile) {
      remaining.push(passengerId);
      continue;
    }
    taken.add(`${tile.x},${tile.y}`);
    const world = gridToWorld(tile, grids);
    passenger.x = world.x;
    passenger.y = world.y;
    passenger.embarkedInId = null;
    passenger.path = [];
  }
  transport.passengerIds = remaining;
}

// Wie nearestWalkableTile, aber ueberspringt bereits vergebene Kacheln -
// nur fuers Absetzen mehrerer Passagiere in einem Zug.
function nearestFreeWalkableTile(grids: WalkabilityGrids, domain: Domain, center: GridPoint, maxRadius: number, taken: Set<string>): GridPoint | null {
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        if (taken.has(`${x},${y}`)) continue;
        if (isWalkable(grids, domain, x, y)) return { x, y };
      }
    }
  }
  return null;
}

// Anlauf zum Transport (analog updateAttackChase): ausserhalb von
// EMBARK_RANGE laeuft die Einheit zur naechsten begehbaren Kachel am
// Transport, innerhalb steigt sie ein. Der Pfad wird nur neu geplant, wenn
// sich die Ziel-Kachel aendert (Transport faehrt weiter).
function updateEmbarkChase(unit: UnitState, grids: WalkabilityGrids): void {
  if (!unit.embarkTargetId) return;
  const transport = findUnit(unit.embarkTargetId);
  // Transport weg, voll oder selbst eingestiegen: Befehl verwerfen.
  if (!transport || transport.passengerIds.length >= TRANSPORT_CAPACITY[transport.unitType]) {
    unit.embarkTargetId = null;
    unit.embarkGoal = null;
    unit.path = [];
    return;
  }

  if (Math.hypot(transport.x - unit.x, transport.y - unit.y) <= EMBARK_RANGE) {
    transport.passengerIds.push(unit.id);
    unit.embarkedInId = transport.id;
    unit.embarkTargetId = null;
    unit.embarkGoal = null;
    unit.path = [];
    return;
  }

  const transportTile = worldToGrid(transport.x, transport.y, grids);
  const goalTile = nearestWalkableTile(grids, UNIT_DOMAIN[unit.unitType], transportTile, 3);
  if (!goalTile) return; // Transport gerade unerreichbar (z. B. Boot auf offener See)
  if (!unit.embarkGoal || unit.embarkGoal.x !== goalTile.x || unit.embarkGoal.y !== goalTile.y) {
    unit.embarkGoal = goalTile;
    const startTile = worldToGrid(unit.x, unit.y, grids);
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

// Verfolgung bei explizitem Angriffsbefehl: ausserhalb der Reichweite laeuft
// die Einheit auf das Ziel zu, innerhalb bleibt sie stehen und feuert (siehe
// resolveShots). Der Pfad wird nur neu geplant, wenn sich die Ziel-Kachel
// geaendert hat - nicht jeden Tick. Das Ziel kann eine Einheit ODER ein
// Gebaeude sein (beide haben x/y; Gebaeude stehen still, der Pfad wird also
// genau einmal geplant).
function updateAttackChase(unit: UnitState, grids: WalkabilityGrids): void {
  if (!unit.attackTargetId) return;
  const target = findUnit(unit.attackTargetId) ?? findBuilding(unit.attackTargetId);
  if (!target) {
    unit.attackTargetId = null;
    unit.attackGoal = null;
    unit.path = [];
    return;
  }

  if (Math.hypot(target.x - unit.x, target.y - unit.y) <= WEAPONS[unit.unitType].range) {
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
// Ohne Befehl: Auto-Feuer auf den naechsten Feind in Reichweite, den die
// eigene Waffe ueberhaupt treffen kann (WEAPONS.targets).
function selectFireTarget(unit: UnitState): UnitState | null {
  const range = WEAPONS[unit.unitType].range;

  if (unit.attackTargetId) {
    const target = findUnit(unit.attackTargetId);
    if (target && Math.hypot(target.x - unit.x, target.y - unit.y) <= range) return target;
    return null;
  }

  let nearest: UnitState | null = null;
  let nearestDistance = Infinity;
  for (const other of units) {
    if (other.faction === unit.faction) continue;
    // Eingestiegene Einheiten sind im Transport unsichtbar und ungeschuetzt
    // nur ueber ihn angreifbar.
    if (other.embarkedInId) continue;
    if (!canTarget(unit.unitType, other.unitType)) continue;
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
    // Eingestiegene Einheiten feuern nicht (kein Kampf aus dem Transport).
    if (unit.embarkedInId) continue;
    const target = selectFireTarget(unit);
    if (target) {
      unit.cooldownMs = WEAPONS[unit.unitType].cooldownMs;
      unit.heading = Math.atan2(target.y - unit.y, target.x - unit.x);
      shots.push({
        attackerId: unit.id,
        targetId: target.id,
        fromX: unit.x,
        fromY: unit.y,
        toX: target.x,
        toY: target.y,
        projectile: WEAPONS[unit.unitType].projectile,
      });
      pendingDamage.push({ targetId: target.id, damage: weaponDamage(unit.unitType, target.unitType) });
      continue;
    }

    // Explizites Gebaeude-Ziel in Reichweite (setAttackTarget hat die
    // Land-Domain schon geprueft). Kein bonusVs gegen Gebaeude, und der
    // Schaden darf sofort abgezogen werden: Gebaeude schiessen in diesem
    // Loop nicht zurueck (Tuerme feuern separat in buildings.ts), die
    // "beide feuern gleichzeitig"-Regel gilt nur zwischen Einheiten.
    const building = unit.attackTargetId ? findBuilding(unit.attackTargetId) : undefined;
    if (!building || Math.hypot(building.x - unit.x, building.y - unit.y) > WEAPONS[unit.unitType].range) continue;
    unit.cooldownMs = WEAPONS[unit.unitType].cooldownMs;
    unit.heading = Math.atan2(building.y - unit.y, building.x - unit.x);
    shots.push({
      attackerId: unit.id,
      targetId: building.id,
      fromX: unit.x,
      fromY: unit.y,
      toX: building.x,
      toY: building.y,
      projectile: WEAPONS[unit.unitType].projectile,
    });
    building.hp -= WEAPONS[unit.unitType].damage;
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

  // Passagiere sterben mit ihrem Transport - Einsteigen ist Schutz UND
  // Risiko. (Eingestiegene sind sonst nirgends angreifbar, siehe
  // selectFireTarget.)
  for (const unit of units) {
    if (unit.embarkedInId && dead.has(unit.embarkedInId)) dead.add(unit.id);
  }

  units = units.filter((unit) => !dead.has(unit.id));
  for (const unit of units) {
    if (unit.attackTargetId && dead.has(unit.attackTargetId)) {
      unit.attackTargetId = null;
      unit.attackGoal = null;
      unit.path = [];
    }
    if (unit.embarkTargetId && dead.has(unit.embarkTargetId)) {
      unit.embarkTargetId = null;
      unit.embarkGoal = null;
      unit.path = [];
    }
    if (dead.size > 0 && unit.passengerIds.length > 0) {
      unit.passengerIds = unit.passengerIds.filter((id) => !dead.has(id));
    }
  }
}

export function advanceUnits(): { entities: EntitySnapshot[]; shots: ShotEvent[] } {
  if (!activeGrids) return { entities: [], shots: [] };
  const grids = activeGrids;

  updateEnemyAggro(units);

  for (const unit of units) {
    // Eingestiegene Einheiten fahren nur mit: Position folgt dem Transport
    // (relevant fuers Aussteigen und falls der Transport faellt).
    if (unit.embarkedInId) {
      const transport = findUnit(unit.embarkedInId);
      if (transport) {
        unit.x = transport.x;
        unit.y = transport.y;
      }
      continue;
    }
    // Gestunnte Einheiten (Hack, hacking.ts) stehen still; der Stun-Timer
    // laeuft in echten ms pro Tick ab, wie cooldownMs in resolveShots.
    unit.stunnedMs = Math.max(0, unit.stunnedMs - TICK_INTERVAL_MS);
    if (unit.stunnedMs > 0) continue;
    updateEmbarkChase(unit, grids);
    updateAttackChase(unit, grids);
    advanceUnit(unit, grids);
  }

  const shots = resolveShots();
  removeDeadUnits();

  // Eingestiegene Einheiten tauchen nicht in den Snapshots auf (unsichtbar,
  // tragen keine Sicht bei); ihr Transport meldet stattdessen die Anzahl.
  const entities = units
    .filter((unit) => !unit.embarkedInId)
    .map((unit) => ({
      id: unit.id,
      unitType: unit.unitType,
      faction: unit.faction,
      x: unit.x,
      y: unit.y,
      heading: unit.heading,
      hp: unit.hp,
      path: unit.path.map((tile) => gridToWorld(tile, grids)),
      // Optionale Felder nur setzen, wenn sie zutreffen (spart Snapshot-Bytes
      // und vertraegt sich mit exactOptionalPropertyTypes).
      ...(unit.stunnedMs > 0 ? { stunned: true } : {}),
      ...(unit.passengerIds.length > 0 ? { passengers: unit.passengerIds.length } : {}),
      // "kaempft" fuer den status-Befehl: expliziter Angriffsbefehl oder vor
      // kurzem gefeuert (Cooldown laeuft noch).
      ...(unit.attackTargetId !== null || unit.cooldownMs > 0 ? { fighting: true } : {}),
    }));

  return { entities, shots };
}
