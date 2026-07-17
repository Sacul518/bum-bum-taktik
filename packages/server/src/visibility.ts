import { BUILDINGS, VISION_RANGE, type BuildingSnapshot, type EntityId, type EntitySnapshot, type ReconZone, type ShotEvent } from '@bum-bum-taktik/shared';

// Fog of War (docs/KONZEPT.md Abschnitt 9, Phase 2): Koop = geteilte Sicht,
// darum EIN gefiltertes Paket fuer alle Clients statt pro Spieler eigene
// Sicht zu berechnen. Sichtbar sind alle Spieler-Einheiten sowie die
// Feind-Einheiten, die mindestens eine Spieler-Einheit in ihrer VISION_RANGE
// hat (euklidisch) - dazu Feinde, die in diesem Tick geschossen haben:
// Muendungsfeuer verraet die Position, sonst waeren deren ShotEvents Tracer
// aus dem Nichts (die Schuss-Events selbst werden nicht gefiltert, siehe
// index.ts - nur welche Feind-Entities im "entities"-Snapshot auftauchen).
// Zusaetzlich sichtbar: Feinde in einem aktiven Aufklaerungs-Sweep (recon.ts)
// und Feinde im Sichtradius eines Spieler-Gebaeudes (buildings.ts) - ein
// eingenommenes Gebaeude wirkt damit wie ein stationaerer Spaeher.
export function filterVisibleEntities(
  entities: EntitySnapshot[],
  shots: ShotEvent[],
  reconZones: ReconZone[] = [],
  buildings: Pick<BuildingSnapshot, 'buildingType' | 'faction' | 'x' | 'y'>[] = [],
): { entities: EntitySnapshot[]; visibleEnemyIds: EntityId[] } {
  const players = entities.filter((entity) => entity.faction === 'player');
  const enemies = entities.filter((entity) => entity.faction === 'enemy');
  const playerBuildings = buildings.filter((building) => building.faction === 'player');
  const firedThisTick = new Set(shots.map((shot) => shot.attackerId));

  const visibleEnemies = enemies.filter((enemy) => {
    if (firedThisTick.has(enemy.id)) return true;
    if (reconZones.some((zone) => Math.hypot(enemy.x - zone.x, enemy.y - zone.y) <= zone.radius)) return true;
    if (playerBuildings.some((building) => Math.hypot(enemy.x - building.x, enemy.y - building.y) <= BUILDINGS[building.buildingType].vision)) return true;
    return players.some((player) => Math.hypot(enemy.x - player.x, enemy.y - player.y) <= VISION_RANGE[player.unitType]);
  });

  return {
    entities: [...players, ...visibleEnemies],
    visibleEnemyIds: visibleEnemies.map((enemy) => enemy.id),
  };
}
