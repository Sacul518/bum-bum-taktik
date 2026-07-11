import { WebSocketServer } from 'ws';
import {
  DEFAULT_PRESET_ID,
  DEFAULT_SERVER_PORT,
  MAP_PRESETS,
  TICK_INTERVAL_MS,
  computeWalkability,
  encodeServerMessage,
  generatePresetMap,
  isMapPresetId,
  type ClientCommand,
  type ServerHello,
  type StateUpdate,
} from '@bum-bum-taktik/shared';
import { advanceUnits, initUnits, setAttackTarget, setUnitTargets } from './gameLoop.js';

// Start-Preset per Umgebungsvariable waehlbar (MAP_PRESET=meer npm run dev),
// solange die Auswahl per Terminal-Befehl (docs/KONZEPT.md Abschnitt 3.1/6)
// noch nicht verdrahtet ist. Default: die bisherige Plains-Karte.
const presetEnv = process.env.MAP_PRESET ?? DEFAULT_PRESET_ID;
if (!isMapPresetId(presetEnv)) {
  console.error(`Unbekanntes MAP_PRESET "${presetEnv}" - verfuegbar: ${Object.keys(MAP_PRESETS).join(', ')}`);
  process.exit(1);
}
const preset = MAP_PRESETS[presetEnv];

const map = generatePresetMap(preset.id);
console.log(`Karte generiert: Preset "${preset.name}" (${map.width}x${map.height}, Seed ${preset.gen.seed ?? 1})`);

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
    mapWidth: map.width,
    mapHeight: map.height,
    terrain: map.terrain.buffer as ArrayBuffer,
    elevation: map.elevation.buffer as ArrayBuffer,
  };
  socket.send(encodeServerMessage(hello));

  socket.on('message', (data) => {
    try {
      const command = JSON.parse(data.toString()) as ClientCommand;
      if (command.type === 'move') {
        setUnitTargets(command.unitIds, command.target[0], command.target[1]);
      } else if (command.type === 'attack') {
        setAttackTarget(command.unitId, command.targetId);
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
  const { entities, shots } = advanceUnits();
  const state: StateUpdate = {
    type: 'state',
    tick,
    entities,
    shots,
    visibleEnemyIds: [],
  };
  const payload = encodeServerMessage(state);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}, TICK_INTERVAL_MS);
