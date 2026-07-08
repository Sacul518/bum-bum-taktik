import { WebSocketServer } from 'ws';
import {
  DEFAULT_SERVER_PORT,
  TICK_INTERVAL_MS,
  type ClientCommand,
  type ServerHello,
  type StateUpdate,
} from '@bum-bum-taktik/shared';
import { advanceUnit, setUnitTarget } from './gameLoop.js';

// Platzhalter-Kartengroesse fuer den Walking Skeleton. Echte
// Terrain-Generierung folgt in Phase 1 (siehe docs/KONZEPT.md Abschnitt 3).
const MAP_WIDTH = 100;
const MAP_HEIGHT = 100;

const wss = new WebSocketServer({ port: DEFAULT_SERVER_PORT });
console.log(`Server laeuft auf ws://localhost:${DEFAULT_SERVER_PORT}`);

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
    terrain: new ArrayBuffer(0),
  };
  socket.send(JSON.stringify(hello));

  socket.on('message', (data) => {
    try {
      const command = JSON.parse(data.toString()) as ClientCommand;
      if (command.type === 'move') {
        setUnitTarget(command.target[0], command.target[1]);
      }
    } catch (err) {
      console.error('Ungueltiger Client-Befehl:', err);
    }
  });

  socket.on('close', () => {
    console.log(`Client getrennt: ${playerId}`);
  });
});

setInterval(() => {
  tick += 1;
  const state: StateUpdate = {
    type: 'state',
    tick,
    entities: [advanceUnit()],
    visibleEnemyIds: [],
  };
  const payload = JSON.stringify(state);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, TICK_INTERVAL_MS);
