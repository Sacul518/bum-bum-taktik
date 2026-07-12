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
import { advanceUnits, initUnits, setAttackTarget, setUnitTargets } from './gameLoop.js';
import { filterVisibleEntities } from './visibility.js';

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

function switchMap(presetId: MapPresetId, setup?: MissionUnitSetup[]): void {
  const preset = MAP_PRESETS[presetId];
  currentPresetId = presetId;
  map = generatePresetMap(presetId);
  walkability = computeWalkability(map);
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
  const { entities, shots } = advanceUnits();
  const { entities: visibleEntities, visibleEnemyIds } = filterVisibleEntities(entities, shots);
  const state: StateUpdate = {
    type: 'state',
    tick,
    entities: visibleEntities,
    shots,
    visibleEnemyIds,
  };
  const payload = encodeServerMessage(state);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, TICK_INTERVAL_MS);
