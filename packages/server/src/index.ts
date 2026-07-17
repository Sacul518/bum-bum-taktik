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
  type ClientCommand,
  type MapPresetId,
  type MissionUnitSetup,
  type ServerHello,
  type StateUpdate,
  type TerrainMap,
  type WalkabilityGrids,
} from '@bum-bum-taktik/shared';
import { advanceUnits, getUnits, initUnits, orderDisembark, orderEmbark, setAttackTarget, setUnitTargets } from './gameLoop.js';
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

function switchMap(presetId: MapPresetId, setup?: MissionUnitSetup[]): void {
  const preset = MAP_PRESETS[presetId];
  currentPresetId = presetId;
  map = generatePresetMap(presetId);
  walkability = computeWalkability(map);
  // Laufende Hacks/Sweeps zeigen nach dem Einheiten-Neuaufbau ins Leere.
  clearAllHacks();
  clearReconZones();
  missionEnded = false;
  initUnits(walkability, setup);
  console.log(`Karte generiert: Preset "${preset.name}" (${map.width}x${map.height}, Seed ${preset.gen.seed ?? 1})`);
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

  const { entities, shots } = advanceUnits();

  // Siegpruefung (docs/KONZEPT.md Abschnitt 3.2): nur bei aktiver Mission und
  // nur bis zum ersten Ergebnis. Beide Seiten weg (theoretisch moeglich, wenn
  // die letzten Einheiten sich im selben Tick gegenseitig zerstoeren) zaehlt
  // als Sieg - die Mission war, die Feinde loszuwerden.
  if (activeMissionId && !missionEnded) {
    // Ueber getUnits() statt entities pruefen: eingestiegene Einheiten fehlen
    // in den Snapshots, leben aber - ein Team, dessen letzte Infanterie im
    // Boot sitzt, hat nicht verloren.
    const playersAlive = getUnits().some((unit) => unit.faction === 'player');
    const enemiesAlive = getUnits().some((unit) => unit.faction === 'enemy');
    if (!playersAlive || !enemiesAlive) {
      missionEnded = true;
      const payload = encodeServerMessage({
        type: 'missionEnd',
        missionId: activeMissionId,
        outcome: enemiesAlive ? 'lost' : 'won',
      });
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }
  }

  const reconZones = activeReconZones();
  const { entities: visibleEntities, visibleEnemyIds } = filterVisibleEntities(entities, shots, reconZones);
  const state: StateUpdate = {
    type: 'state',
    tick,
    entities: visibleEntities,
    shots,
    visibleEnemyIds,
    ...(reconZones.length > 0 ? { reconZones } : {}),
  };
  const payload = encodeServerMessage(state);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, TICK_INTERVAL_MS);
