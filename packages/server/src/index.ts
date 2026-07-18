import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_PRESET_ID,
  DEFAULT_SERVER_PORT,
  MAP_PRESETS,
  TICK_INTERVAL_MS,
  computeWalkability,
  encodeServerMessage,
  generatePresetMap,
  getMission,
  isMapPresetId,
  isMissionUnlocked,
  type BuildingFaction,
  type BuildingType,
  type ClientCommand,
  type GameEvent,
  type MapPresetId,
  type MissionObjective,
  type MissionUnitSetup,
  type UnitType,
  type ServerHello,
  type StateUpdate,
  type TerrainMap,
  type WalkabilityGrids,
} from '@bum-bum-taktik/shared';
import { advanceUnits, getUnits, initUnits, orderDisembark, orderEmbark, setAttackTarget, setUnitTargets, spawnProducedUnit } from './gameLoop.js';
import { buildingSnapshots, getBuildings, initBuildings, updateBuildings } from './buildings.js';
import { getResources, initEconomy, updateEconomy } from './economy.js';
import { filterVisibleEntities } from './visibility.js';
import { abortHack, attemptHack, clearAllHacks, expireTimedOutHacks, startHack } from './hacking.js';
import { activeReconZones, clearReconZones, requestRecon } from './recon.js';

// Start-Preset per Umgebungsvariable waehlbar (MAP_PRESET=meer npm run dev);
// danach wechselbar per selectMap-Befehl aus dem Terminal (docs/KONZEPT.md
// Abschnitt 3.1/6). Default: die bisherige Plains-Karte.
const presetEnv = process.env.MAP_PRESET ?? DEFAULT_PRESET_ID;
if (!isMapPresetId(presetEnv)) {
  console.error(`Unbekanntes MAP_PRESET "${presetEnv}" - verfuegbar: ${Object.keys(MAP_PRESETS).join(', ')}`);
  process.exit(1);
}

// Karte + Begehbarkeit sind veraenderbarer Zustand: switchMap() ersetzt sie
// bei einem Kartenwechsel komplett und spawnt die Einheiten neu (immer eine
// frische Generierung, auch wenn die Region gleich bleibt - ein Missions-
// neustart soll wieder bei Null anfangen). Wird auch fuer die Erst-
// Generierung beim Start benutzt (Aufruf direkt darunter).
let currentPresetId: MapPresetId;
let map: TerrainMap;
let walkability: WalkabilityGrids;

// Aktive Mission (docs/KONZEPT.md Abschnitt 3.2) oder null = freie
// Aufstellung. selectMap setzt sie zurueck, startMission setzt sie.
let activeMissionId: string | null = null;

// Sperrt die Siegpruefung, sobald das Ergebnis einmal gemeldet wurde - die
// Welt laeuft nach Missionsende weiter, sonst wuerde missionEnd jeden Tick
// erneut gesendet.
let missionEnded = false;

// Gewonnene Missionen der Kampagnen-Kette (shared/missions.ts) - nur im
// Server-Speicher, Persistenz kommt in Session C.
const wonMissionIds = new Set<string>();

// Startwerte der aktuellen Karte fuer die Zielpruefung: ob HQs ueberhaupt
// platziert wurden - auf Karten mit wenig Land kann eine Platzierung
// scheitern (initBuildings), dann darf ein fehlendes HQ weder Sofort-Sieg
// noch Sofort-Niederlage ausloesen.
let missionStats = { hadPlayerHq: false, hadEnemyHq: false };

// Kumulierte Feind-Abschuesse fuer eliminateAll: "initial minus lebend"
// wuerde negativ, sobald die Feind-Fabrik nachproduziert (im Headless-Test
// 2026-07-18 genau so passiert). done = Abschuesse, total = Abschuesse +
// noch lebende Feinde: done erreicht total genau dann, wenn kein Feind mehr
// uebrig ist, und sinkt nie.
let enemyUnitsKilled = 0;

// Ereignis-Erkennung fuers Terminal-Event-Log (PLAN.md Session A, Aufgabe 5):
// Vergleich mit dem vorigen Tick. Nach einem Kartenwechsel ist die Baseline
// null und der erste Tick meldet nichts - sonst waere jede Start-Einheit ein
// "produced"-Ereignis.
const UNDER_FIRE_THROTTLE_MS = 5000;
let eventBaseline: {
  playerUnits: Map<string, UnitType>;
  enemyUnitIds: Set<string>;
  buildings: Map<string, { buildingType: BuildingType; faction: BuildingFaction }>;
  objectiveDone: number | null;
} | null = null;
// Letzter "unter Beschuss"-Zeitpunkt pro Einheit (Drosselung).
const underFireAt = new Map<string, number>();

function switchMap(presetId: MapPresetId, setup?: MissionUnitSetup[]): void {
  const preset = MAP_PRESETS[presetId];
  currentPresetId = presetId;
  map = generatePresetMap(presetId);
  walkability = computeWalkability(map);
  // Laufende Hacks/Sweeps zeigen nach dem Einheiten-Neuaufbau ins Leere.
  clearAllHacks();
  clearReconZones();
  missionEnded = false;
  eventBaseline = null;
  underFireAt.clear();
  initUnits(walkability, setup);
  initBuildings(walkability);
  initEconomy();
  missionStats = {
    hadPlayerHq: getBuildings().some((building) => building.id === 'hq-player'),
    hadEnemyHq: getBuildings().some((building) => building.id === 'hq-enemy'),
  };
  enemyUnitsKilled = 0;
  console.log(`Karte generiert: Preset "${preset.name}" (${map.width}x${map.height}, Seed ${preset.gen.seed ?? 1})`);
}

// Fortschritt zum Missionsziel (protocol.ts objectiveProgress): done/total
// je nach Zieltyp - Sieg, sobald done >= total (Pruefung im Tick unten).
function objectiveProgress(objective: MissionObjective): { done: number; total: number } {
  switch (objective.kind) {
    case 'eliminateAll': {
      const alive = getUnits().filter((unit) => unit.faction === 'enemy').length;
      return { done: enemyUnitsKilled, total: enemyUnitsKilled + alive };
    }
    case 'destroyHQ': {
      // Fehlte das Feind-HQ von Anfang an (Platzierung gescheitert), gilt
      // das Ziel als erreicht - es gibt nichts zu zerstoeren.
      const standing = missionStats.hadEnemyHq && getBuildings().some((building) => building.id === 'hq-enemy');
      return { done: standing ? 0 : 1, total: 1 };
    }
    case 'captureCities': {
      const owned = getBuildings().filter((building) => building.buildingType === 'city' && building.faction === 'player').length;
      return { done: Math.min(owned, objective.count), total: objective.count };
    }
  }
}

switchMap(presetEnv);

const wss = new WebSocketServer({ port: DEFAULT_SERVER_PORT });
console.log(`Server laeuft auf ws://localhost:${DEFAULT_SERVER_PORT}`);

wss.on('error', (err) => {
  console.error('WebSocket-Server-Fehler:', err);
});

let nextPlayerNumber = 1;
let tick = 0;

function buildHello(playerId: string): ServerHello {
  return {
    type: 'hello',
    playerId,
    preset: currentPresetId,
    missionId: activeMissionId,
    wonMissionIds: [...wonMissionIds],
    mapWidth: map.width,
    mapHeight: map.height,
    terrain: map.terrain.buffer as ArrayBuffer,
    elevation: map.elevation.buffer as ArrayBuffer,
  };
}

// Verbundene Clients mit ihrer playerId: nach einem Kartenwechsel bekommt
// jeder Client sein hello erneut (jeder ein eigenes, wegen der playerId).
const connectedPlayers = new Map<WebSocket, string>();

// Nach jedem Karten-/Missionswechsel bekommt jeder verbundene Client sein
// (aktualisiertes) hello erneut - jedes hello ist ein kompletter Neuaufbau
// der Welt auf Client-Seite.
function broadcastHello(): void {
  for (const [client, clientPlayerId] of connectedPlayers) {
    if (client.readyState === client.OPEN) {
      client.send(encodeServerMessage(buildHello(clientPlayerId)));
    }
  }
}

wss.on('connection', (socket) => {
  const playerId = `player-${nextPlayerNumber++}`;
  connectedPlayers.set(socket, playerId);
  console.log(`Client verbunden: ${playerId}`);

  socket.send(encodeServerMessage(buildHello(playerId)));

  socket.on('message', (data) => {
    try {
      const command = JSON.parse(data.toString()) as ClientCommand;
      if (command.type === 'move') {
        setUnitTargets(command.unitIds, command.target[0], command.target[1]);
      } else if (command.type === 'attack') {
        setAttackTarget(command.unitId, command.targetId);
      } else if (command.type === 'selectMap') {
        // preset kommt als JSON von aussen - zur Laufzeit pruefen, nicht nur
        // dem TypeScript-Typ vertrauen.
        if (!isMapPresetId(command.preset)) {
          console.error(`selectMap mit unbekanntem Preset "${String(command.preset)}" ignoriert`);
          return;
        }
        // Freie Aufstellung: eine laufende Mission wird verlassen.
        activeMissionId = null;
        switchMap(command.preset);
        broadcastHello();
      } else if (command.type === 'startMission') {
        // missionId kommt als JSON von aussen - zur Laufzeit gegen MISSIONS
        // pruefen, nicht nur dem TypeScript-Typ vertrauen.
        const mission = getMission(command.missionId);
        if (!mission) {
          console.error(`startMission mit unbekannter missionId "${command.missionId}" ignoriert`);
          return;
        }
        // Ketten-Sperre serverseitig erzwingen - der Client zeigt gesperrte
        // Missionen zwar schon als [gesperrt] an, aber der Befehl kommt als
        // JSON von aussen.
        if (!isMissionUnlocked(mission.id, [...wonMissionIds])) {
          console.error(`startMission "${mission.id}" ignoriert - noch gesperrt (Vorgaengerin nicht gewonnen)`);
          return;
        }
        activeMissionId = mission.id;
        // Immer frisch generieren, auch wenn die Region gleich bleibt - ein
        // Missionsneustart soll wieder bei der Startaufstellung anfangen.
        switchMap(mission.region, mission.setup);
        broadcastHello();
      } else if (command.type === 'hackStart') {
        // Antwort (Challenge oder Ablehnung) geht nur an den Anforderer -
        // unicast, siehe protocol.ts.
        socket.send(encodeServerMessage(startHack(String(command.targetId), playerId, getUnits())));
      } else if (command.type === 'hackAttempt') {
        socket.send(encodeServerMessage(attemptHack(String(command.hackId), String(command.answer), playerId, getUnits())));
      } else if (command.type === 'hackAbort') {
        const result = abortHack(String(command.hackId), playerId);
        if (result) socket.send(encodeServerMessage(result));
      } else if (command.type === 'embark') {
        orderEmbark(command.unitIds.map(String), String(command.transportId));
      } else if (command.type === 'disembark') {
        orderDisembark(String(command.transportId));
      } else if (command.type === 'recon') {
        // Zahlen kommen als JSON von aussen - NaN o. ae. abfangen, bevor der
        // Sweep in den Sichtbarkeits-Vergleich wandert.
        const { x, y, radius } = command;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) {
          console.error('recon mit ungueltigen Koordinaten ignoriert');
          return;
        }
        socket.send(encodeServerMessage(requestRecon(x, y, radius)));
      }
    } catch (err) {
      console.error('Ungueltiger Client-Befehl:', err);
    }
  });

  socket.on('close', () => {
    connectedPlayers.delete(socket);
    console.log(`Client getrennt: ${playerId}`);
  });

  // ws-Sockets sind EventEmitter: ein error-Event ohne Listener wirft und
  // beendet den ganzen Node-Prozess - ein einziger Verbindungsfehler (z. B.
  // iPad im Ruhezustand, TCP-Reset) wuerde sonst den Server fuer alle killen.
  socket.on('error', (err) => {
    console.error(`Socket-Fehler (${playerId}):`, err);
  });
});

setInterval(() => {
  tick += 1;

  // Abgelaufene Hack-Fristen: Ergebnis aktiv an den jeweiligen Anforderer
  // schicken (unicast) - der Client wartet sonst ewig auf sein hackResult.
  for (const { requesterId, result } of expireTimedOutHacks(getUnits())) {
    for (const [client, clientPlayerId] of connectedPlayers) {
      if (clientPlayerId === requesterId && client.readyState === client.OPEN) {
        client.send(encodeServerMessage(result));
      }
    }
  }

  // Gebaeude-Tick VOR den Einheiten: Turm-Schaden und frisch produzierte
  // Einheiten sind dann im selben advanceUnits/Snapshot schon beruecksichtigt
  // (Turm-Opfer werden von removeDeadUnits entfernt, neue Infanterie taucht
  // sofort in den entities auf).
  const towerShots = updateBuildings(getUnits(), spawnProducedUnit);
  updateEconomy(getBuildings(), TICK_INTERVAL_MS);
  const { entities, shots: unitShots } = advanceUnits();
  const shots = [...unitShots, ...towerShots];

  // Zielpruefung (PLAN.md Session A, Aufgabe 4): nur bei aktiver Mission und
  // nur bis zum ersten Ergebnis. Sieg, sobald das Missionsziel erreicht ist;
  // Niederlage, wenn alle eigenen Einheiten fallen oder das eigene HQ faellt.
  // Ziel erreicht schlaegt Niederlage im selben Tick (zerstoeren sich die
  // letzten Einheiten gegenseitig, zaehlt ein erfuelltes Ziel als Sieg).
  // Feind-Abschuesse VOR der Fortschrittsberechnung zaehlen (eliminateAll
  // basiert darauf) - Vergleichsbasis ist der Einheitenstand des vorigen
  // Ticks aus der Event-Baseline.
  const currentEnemyIds = new Set(
    getUnits()
      .filter((unit) => unit.faction === 'enemy')
      .map((unit) => unit.id),
  );
  if (eventBaseline) {
    for (const id of eventBaseline.enemyUnitIds) {
      if (!currentEnemyIds.has(id)) enemyUnitsKilled += 1;
    }
  }

  const activeMission = activeMissionId ? getMission(activeMissionId) : undefined;
  const progress = activeMission ? objectiveProgress(activeMission.objective) : undefined;
  if (activeMission && progress && !missionEnded) {
    // Ueber getUnits() statt entities pruefen: eingestiegene Einheiten fehlen
    // in den Snapshots, leben aber - ein Team, dessen letzte Infanterie im
    // Boot sitzt, hat nicht verloren.
    const playersAlive = getUnits().some((unit) => unit.faction === 'player');
    const playerHqFallen = missionStats.hadPlayerHq && !getBuildings().some((building) => building.id === 'hq-player');

    let outcome: 'won' | 'lost' | null = null;
    let reason: 'unitsLost' | 'hqLost' | undefined;
    if (progress.done >= progress.total) {
      outcome = 'won';
    } else if (playerHqFallen) {
      outcome = 'lost';
      reason = 'hqLost';
    } else if (!playersAlive) {
      outcome = 'lost';
      reason = 'unitsLost';
    }

    if (outcome) {
      missionEnded = true;
      if (outcome === 'won') wonMissionIds.add(activeMission.id);
      const payload = encodeServerMessage({
        type: 'missionEnd',
        missionId: activeMission.id,
        outcome,
        ...(reason ? { reason } : {}),
        wonMissionIds: [...wonMissionIds],
      });
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }
  }

  // Ereignisse per Diff zum vorigen Tick sammeln (Baseline null nach
  // Kartenwechsel = erster Tick meldet nichts, baut nur die Baseline auf).
  const events: GameEvent[] = [];
  const currentPlayerUnits = new Map<string, UnitType>(
    getUnits()
      .filter((unit) => unit.faction === 'player')
      .map((unit) => [unit.id, unit.unitType]),
  );
  const currentBuildings = new Map(
    getBuildings().map((building) => [building.id, { buildingType: building.buildingType, faction: building.faction }]),
  );
  if (eventBaseline) {
    for (const [id, unitType] of eventBaseline.playerUnits) {
      if (!currentPlayerUnits.has(id)) events.push({ kind: 'unitLost', unitId: id, unitType });
    }
    // Neue eigene Einheit = Fabrik-Produktion (nur Fabriken erzeugen im
    // laufenden Spiel Einheiten). Feind-Produktion wird bewusst nicht
    // gemeldet - die faende im Fog of War statt.
    for (const [id, unitType] of currentPlayerUnits) {
      if (!eventBaseline.playerUnits.has(id)) events.push({ kind: 'produced', unitId: id, unitType });
    }
    for (const [id, previous] of eventBaseline.buildings) {
      const current = currentBuildings.get(id);
      if (!current) {
        // Zerstoerung nur fuer eigene Gebaeude melden; ein Fraktionswechsel
        // ist dagegen eine Einnahme (beide Richtungen melden).
        if (previous.faction === 'player') events.push({ kind: 'buildingLost', buildingId: id, buildingType: previous.buildingType });
      } else if (current.faction !== previous.faction && current.faction !== 'neutral') {
        events.push({ kind: 'captured', buildingId: id, buildingType: current.buildingType, byFaction: current.faction });
      }
    }
    // Unter Beschuss: Treffer auf noch lebende eigene Einheiten, pro Einheit
    // gedrosselt. Frisch Gefallene erzeugen schon das unitLost-Ereignis.
    const now = Date.now();
    for (const shot of shots) {
      const unitType = currentPlayerUnits.get(shot.targetId);
      if (!unitType) continue;
      const last = underFireAt.get(shot.targetId);
      if (last !== undefined && now - last < UNDER_FIRE_THROTTLE_MS) continue;
      underFireAt.set(shot.targetId, now);
      events.push({ kind: 'underFire', unitId: shot.targetId, unitType });
    }
    if (progress && eventBaseline.objectiveDone !== null && progress.done !== eventBaseline.objectiveDone) {
      events.push({ kind: 'objective', done: progress.done, total: progress.total });
    }
  }
  eventBaseline = {
    playerUnits: currentPlayerUnits,
    enemyUnitIds: currentEnemyIds,
    buildings: currentBuildings,
    objectiveDone: progress ? progress.done : null,
  };

  const reconZones = activeReconZones();
  const buildings = buildingSnapshots();
  const { entities: visibleEntities, visibleEnemyIds } = filterVisibleEntities(entities, shots, reconZones, buildings);
  const state: StateUpdate = {
    type: 'state',
    tick,
    entities: visibleEntities,
    shots,
    visibleEnemyIds,
    buildings,
    resources: getResources('player'),
    ...(reconZones.length > 0 ? { reconZones } : {}),
    ...(progress ? { objectiveProgress: progress } : {}),
    ...(events.length > 0 ? { events } : {}),
  };
  const payload = encodeServerMessage(state);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, TICK_INTERVAL_MS);
