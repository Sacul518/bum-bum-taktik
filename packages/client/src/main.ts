import * as THREE from 'three';
import { DEFAULT_SERVER_PORT, TICK_INTERVAL_MS } from '@bum-bum-taktik/shared';
import type { EntitySnapshot } from '@bum-bum-taktik/shared';
import {
  createCameraRig,
  updateCameraAspect,
  panCamera,
  rotateCamera,
  tiltCamera,
  getGroundAxes,
} from './render/camera.js';
import { createScene } from './render/scene.js';
import { createTerrainMesh, sampleElevation } from './render/terrain.js';
import { createUnitMesh, applySnapshot, setSelected } from './render/units.js';
import { createPathLine, updatePathLine } from './render/path.js';
import { connectToServer, sendCommand } from './net/client.js';

const app = document.getElementById('app');
if (!app) throw new Error('#app fehlt in index.html');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = createScene();
const cameraRig = createCameraRig(window.innerWidth / window.innerHeight);
const camera = cameraRig.camera;

const pathLine = createPathLine();
scene.add(pathLine);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCameraAspect(camera, window.innerWidth / window.innerHeight);
});

// Snapshot-Interpolation (docs/KONZEPT.md Abschnitt 2.1): der Client haelt
// die letzten zwei Server-Updates pro Einheit vor und blendet zwischen ihnen,
// damit 60fps-Rendering trotz 12Hz-Server-Updates fluessig wirkt.
interface BufferedSnapshot {
  receivedAt: number;
  entities: Map<string, EntitySnapshot>;
}

let previousSnapshot: BufferedSnapshot | null = null;
let latestSnapshot: BufferedSnapshot | null = null;
const unitMeshes = new Map<string, THREE.Object3D>();

// Auswahl (docs/KONZEPT.md Abschnitt 5.3): erster Klick auf eine Einheit
// selektiert sie, ein zweiter Klick auf den Boden bewegt nur die Auswahl.
// Aktuell genau eine Einheit gleichzeitig - Mehrfachauswahl (Drag-Box,
// Hotkey-Gruppen) kommt spaeter.
const selectedUnitIds = new Set<string>();

// Vom "hello" gemerkt, damit der Renderloop weiter unten Einheiten auf die
// tatsaechliche Kachelhoehe setzen kann (sonst sinken Fahrzeuge in Huegeln
// ein bzw. schweben ueber tieferem Wasser).
let terrainElevation: Float32Array | null = null;
let mapWidth = 0;
let mapHeight = 0;

const socket = connectToServer(`ws://${window.location.hostname}:${DEFAULT_SERVER_PORT}`, {
  onOpen: () => console.log('Mit Server verbunden.'),
  onClose: () => console.log('Verbindung zum Server getrennt.'),
  onMessage: (message) => {
    if (message.type === 'hello') {
      const terrainTypes = new Uint8Array(message.terrain);
      mapWidth = message.mapWidth;
      mapHeight = message.mapHeight;
      terrainElevation = new Float32Array(message.elevation);
      scene.add(createTerrainMesh(mapWidth, mapHeight, terrainTypes, terrainElevation));
      return;
    }

    if (message.type === 'state') {
      const entities = new Map(message.entities.map((entity) => [entity.id, entity]));
      previousSnapshot = latestSnapshot;
      latestSnapshot = { receivedAt: performance.now(), entities };
    }
  },
});

// Kamera ist die zentrale Steuerung (docs/KONZEPT.md Abschnitt 5.1): sie wird
// per Touch-/Maus-Ziehen oder WASD geschwenkt. Ein Tippen ohne nennenswerte
// Bewegung zaehlt dagegen als Klick-zum-Ziel fuer die Einheit - beides teilt
// sich denselben Boden-Raycast, daher hier zusammen implementiert.
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerNdc = new THREE.Vector2();
const DRAG_THRESHOLD_PX = 6;

renderer.domElement.style.touchAction = 'none';

function raycastGround(clientX: number, clientY: number): THREE.Vector3 | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, point) ? point : null;
}

// Prueft, ob der Klick eine Einheit trifft (fuer Auswahl statt Bewegung).
// Nutzt denselben Raycaster wie raycastGround(), daher muss setFromCamera()
// hier erneut aufgerufen werden - der Raycaster ist zustandsbehaftet.
function raycastUnit(clientX: number, clientY: number): string | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(Array.from(unitMeshes.values()), true);
  if (hits.length === 0) return null;

  let hitObject: THREE.Object3D | null = hits[0]!.object;
  while (hitObject && !hitObject.userData.unitId) {
    hitObject = hitObject.parent;
  }
  return (hitObject?.userData.unitId as string | undefined) ?? null;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  anchorWorld: THREE.Vector3 | null;
}

let drag: DragState | null = null;

renderer.domElement.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  renderer.domElement.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    anchorWorld: raycastGround(event.clientX, event.clientY),
  };
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;

  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD_PX) {
    drag.moved = true;
  }

  if (drag.moved && drag.anchorWorld) {
    const currentWorld = raycastGround(event.clientX, event.clientY);
    if (currentWorld) {
      panCamera(cameraRig, drag.anchorWorld.x - currentWorld.x, drag.anchorWorld.z - currentWorld.z);
    }
  }
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;

  if (!drag.moved) {
    const clickedUnitId = raycastUnit(event.clientX, event.clientY);
    if (clickedUnitId) {
      selectedUnitIds.clear();
      selectedUnitIds.add(clickedUnitId);
    } else if (drag.anchorWorld && selectedUnitIds.size > 0) {
      sendCommand(socket, {
        type: 'move',
        unitIds: Array.from(selectedUnitIds),
        target: [drag.anchorWorld.x, drag.anchorWorld.z],
      });
    }
  }

  drag = null;
});

// Tastatur-Kamerasteuerung fuer Tests ohne Touch-Geraet: WASD schwenkt,
// Q/E dreht, R/F neigt. Nur unmodifizierte Tasten (docs/KONZEPT.md
// Abschnitt 5.2). Platzhalter-Belegung fuer den Smoke-Test - das richtige
// Eingabe-System (Hotkeys, Terminal-Fokus-Schutz) kommt in Phase 1.
const CAMERA_PAN_SPEED = 20; // Welteinheiten pro Sekunde
const CAMERA_ROTATE_SPEED = 1.2; // rad/s
const CAMERA_TILT_SPEED = 1.0; // rad/s
const pressedKeys = new Set<string>();

window.addEventListener('keydown', (event) => pressedKeys.add(event.key.toLowerCase()));
window.addEventListener('keyup', (event) => pressedKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => pressedKeys.clear());

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateEntity(id: string, current: EntitySnapshot): EntitySnapshot {
  const previous = previousSnapshot?.entities.get(id);
  if (!previous || !latestSnapshot) return current;

  const elapsed = performance.now() - latestSnapshot.receivedAt;
  const t = Math.min(Math.max(elapsed / TICK_INTERVAL_MS, 0), 1);
  return {
    ...current,
    x: lerp(previous.x, current.x, t),
    y: lerp(previous.y, current.y, t),
    heading: lerp(previous.heading, current.heading, t),
  };
}

let lastFrameTime = performance.now();

function render(): void {
  requestAnimationFrame(render);

  const now = performance.now();
  const deltaSeconds = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  // Vorwaerts/Rechts kommen aus dem aktuellen Kamerawinkel, nicht aus den
  // Weltachsen - sonst liefe "vorwaerts" nach einer Drehung schraeg statt
  // geradeaus auf dem Bildschirm.
  let moveForward = 0;
  let moveRight = 0;
  if (pressedKeys.has('w')) moveForward += 1;
  if (pressedKeys.has('s')) moveForward -= 1;
  if (pressedKeys.has('d')) moveRight += 1;
  if (pressedKeys.has('a')) moveRight -= 1;
  if (moveForward !== 0 || moveRight !== 0) {
    const { forward, right } = getGroundAxes(cameraRig);
    const length = Math.hypot(moveForward, moveRight);
    const stepForward = (moveForward / length) * CAMERA_PAN_SPEED * deltaSeconds;
    const stepRight = (moveRight / length) * CAMERA_PAN_SPEED * deltaSeconds;
    panCamera(
      cameraRig,
      forward.x * stepForward + right.x * stepRight,
      forward.y * stepForward + right.y * stepRight,
    );
  }

  if (pressedKeys.has('q')) rotateCamera(cameraRig, -CAMERA_ROTATE_SPEED * deltaSeconds);
  if (pressedKeys.has('e')) rotateCamera(cameraRig, CAMERA_ROTATE_SPEED * deltaSeconds);
  if (pressedKeys.has('r')) tiltCamera(cameraRig, CAMERA_TILT_SPEED * deltaSeconds);
  if (pressedKeys.has('f')) tiltCamera(cameraRig, -CAMERA_TILT_SPEED * deltaSeconds);

  // Path-Tracker: zeigt die verbleibende Route der ausgewaehlten Einheit
  // (docs/KONZEPT.md Abschnitt 5.3). Wird unten im Entity-Loop befuellt,
  // sobald die ausgewaehlte Einheit an der Reihe ist, und danach einmalig
  // auf die wiederverwendete Linie angewandt.
  let selectedPathPoints: THREE.Vector3[] = [];

  if (latestSnapshot) {
    for (const [id, snapshot] of latestSnapshot.entities) {
      let mesh = unitMeshes.get(id);
      if (!mesh) {
        mesh = createUnitMesh(snapshot.unitType);
        mesh.userData.unitId = id;
        unitMeshes.set(id, mesh);
        scene.add(mesh);
      }
      const interpolated = interpolateEntity(id, snapshot);
      const terrainHeight = terrainElevation ? sampleElevation(interpolated.x, interpolated.y, mapWidth, mapHeight, terrainElevation) : 0;
      applySnapshot(mesh, interpolated, terrainHeight);
      setSelected(mesh, selectedUnitIds.has(id));

      if (selectedUnitIds.has(id) && snapshot.path.length > 0 && terrainElevation) {
        selectedPathPoints = [new THREE.Vector3(interpolated.x, terrainHeight, interpolated.y)];
        for (const waypoint of snapshot.path) {
          const waypointHeight = sampleElevation(waypoint.x, waypoint.y, mapWidth, mapHeight, terrainElevation);
          selectedPathPoints.push(new THREE.Vector3(waypoint.x, waypointHeight, waypoint.y));
        }
      }
    }
  }

  updatePathLine(pathLine, selectedPathPoints);

  renderer.render(scene, camera);
}

render();
