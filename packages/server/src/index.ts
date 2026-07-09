import { WebSocketServer } from 'ws';
import {
  DEFAULT_SERVER_PORT,
  TICK_INTERVAL_MS,
  computeWalkability,
  encodeServerMessage,
  generateTerrain,
  type ClientCommand,
  type ServerHello,
  type StateUpdate,
} from '@bum-bum-taktik/shared';
import { advanceUnits, initUnits, setUnitTargets } from './gameLoop.js';

// Platzhalter-Kartengroesse; die endgueltige Groesse wird nach Performance-
// Tests auf echter Hardware festgelegt (siehe docs/KONZEPT.md "Offene Punkte").
const MAP_WIDTH = 100;
const MAP_HEIGHT = 100;

// Seed 1 liefert bei dieser Kartengroesse eine gute Mischung aus allen
// Terrain-Typen (Wasser, Ebene, Huegel, Berge) - per ASCII-Vorschau geprueft
// (packages/shared: npm run preview -- 100 100 1). Wird spaeter pro Match
// zufaellig gewaehlt statt fest verdrahtet.
const TERRAIN_SEED = 1;

const map = generateTerrain(MAP_WIDTH, MAP_HEIGHT, { seed: TERRAIN_SEED });
console.log(`Karte generiert: ${MAP_WIDTH}x${MAP_HEIGHT}, Seed ${TERRAIN_SEED}`);

const walkability = computeWalkability(map);
initUnits(walkability);

const wss = new WebSocketServer({ port: DEFAULT_SERVER_PORT });
console.log(`Server laeuft auf ws://localhost:${DEFAULT_SERVER_PORT}`);

wss.on('error', (err) => {
  console.error('WebSocket-Server-Fehler:', err);
});

let nextPlayerNumber = 1;
let tick = 0;

wss.on('connection', (socket) => {
  const playerId = `player-${nextPlayerNumber++}`;
  console.log(`Client verbunden: ${playerId}`);

  const hello: ServerHello = {
    type: 'hello',
    playerId,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    terrain: map.terrain.buffer as ArrayBuffer,
    elevation: map.elevation.buffer as ArrayBuffer,
  };
  socket.send(encodeServerMessage(hello));

  socket.on('message', (data) => {
    try {
      const command = JSON.parse(data.toString()) as ClientCommand;
      if (command.type === 'move') {
        setUnitTargets(command.unitIds, command.target[0], command.target[1]);
      }
    } catch (err) {
      console.error('Ungueltiger Client-Befehl:', err);
    }
  });

  socket.on('close', () => {
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
  const state: StateUpdate = {
    type: 'state',
    tick,
    entities: advanceUnits(),
    visibleEnemyIds: [],
  };
  const payload = encodeServerMessage(state);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, TICK_INTERVAL_MS);
