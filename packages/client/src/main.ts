import * as THREE from 'three';
import { DEFAULT_SERVER_PORT, TICK_INTERVAL_MS } from '@bum-bum-taktik/shared';
import type { EntitySnapshot, Faction } from '@bum-bum-taktik/shared';
import {
  createCameraRig,
  updateCameraAspect,
  panCamera,
  rotateCamera,
  tiltCamera,
  zoomCamera,
  getGroundAxes,
} from './render/camera.js';
import { createScene } from './render/scene.js';
import { createTerrainMesh, sampleElevation } from './render/terrain.js';
import { createUnitMesh, applySnapshot, setSelected, preloadUnitAtlas } from './render/units.js';
import { createPathLine, updatePathLine } from './render/path.js';
import { spawnTracer, updateTracers } from './render/tracers.js';
import { connectToServer, sendCommand } from './net/client.js';
import { resolveCameraInput } from './input/hotkeys.js';

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
  updateCameraAspect(cameraRig, window.innerWidth / window.innerHeight);
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

// Einheiten-Atlas laedt echte Sprite-Bilder (render/loader.ts) und ist daher
// asynchron - erst awaiten, dann verbinden, damit beim Eintreffen der ersten
// "state"-Nachricht createUnitMesh() bereits synchron auf das fertige
// Material zugreifen kann (docs/KONZEPT.md Abschnitt 7: Atlanten vorab
// laden).
await preloadUnitAtlas();

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

      // Zerstoerte Einheiten (nicht mehr im Snapshot) aus der Szene entfernen.
      for (const [id, mesh] of unitMeshes) {
        if (entities.has(id)) continue;
        scene.remove(mesh);
        unitMeshes.delete(id);
        selectedUnitIds.delete(id);
      }

      for (const shot of message.shots) {
        if (!terrainElevation) break;
        spawnTracer(
          scene,
          shot,
          sampleElevation(shot.fromX, shot.fromY, mapWidth, mapHeight, terrainElevation),
          sampleElevation(shot.toX, shot.toY, mapWidth, mapHeight, terrainElevation),
        );
      }
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

// Mausrad-Zoom fuer Desktop-Tests (docs/KONZEPT.md Abschnitt 5.1/9). Faktor
// statt fixem Schritt, damit ein- und dasselbe "Wheel-Tick" bei jeder
// Zoomstufe gleich stark wirkt (multiplikativ statt additiv). preventDefault
// + { passive: false } noetig, sonst scrollt Safari/Chrome stattdessen die
// Seite.
const WHEEL_ZOOM_SPEED = 0.001;
renderer.domElement.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    zoomCamera(cameraRig, Math.exp(event.deltaY * WHEEL_ZOOM_SPEED));
  },
  { passive: false },
);

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

// Aktive Finger/Zeiger in einer Map<pointerId, {x,y}> verfolgt (docs/KONZEPT.md
// Abschnitt 5.1) statt nur eines einzelnen Drag-Zustands - Voraussetzung fuer
// Pinch-Zoom: aus der Abstandsaenderung zwischen zwei gleichzeitigen Zeigern
// wird der Zoom-Faktor berechnet.
const activePointers = new Map<number, { x: number; y: number }>();
let pinchDistance: number | null = null;

function distanceBetweenPointers(): number | null {
  if (activePointers.size < 2) return null;
  const it = activePointers.values();
  const a = it.next().value!;
  const b = it.next().value!;
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 2) {
    // Zweiter Finger kommt dazu: Pinch-Zoom startet. Ein laufender
    // Ein-Finger-Drag wird verworfen, damit sich Schwenken und Zoomen nicht
    // gegenseitig in die Quere kommen.
    drag = null;
    pinchDistance = distanceBetweenPointers();
  } else if (activePointers.size === 1) {
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      anchorWorld: raycastGround(event.clientX, event.clientY),
    };
  }
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 2) {
    const currentDistance = distanceBetweenPointers();
    if (pinchDistance !== null && currentDistance !== null && currentDistance > 0) {
      // Finger auseinander (currentDistance waechst gegenueber vorher) heisst
      // heranzoomen, daher der Kehrwert (zoomCamera: factor > 1 = herauszoomen,
      // siehe camera.ts).
      zoomCamera(cameraRig, pinchDistance / currentDistance);
    }
    pinchDistance = currentDistance;
    return;
  }

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
  activePointers.delete(event.pointerId);
  pinchDistance = activePointers.size === 2 ? distanceBetweenPointers() : null;

  if (!drag || event.pointerId !== drag.pointerId) return;

  if (!drag.moved) {
    const clickedUnitId = raycastUnit(event.clientX, event.clientY);
    if (clickedUnitId) {
      // Klick auf einen Feind = Angriffsbefehl fuer die Auswahl; Klick auf
      // eine eigene Einheit = Auswahl wechseln. Feinde sind nicht selektierbar.
      const clickedFaction = unitMeshes.get(clickedUnitId)?.userData.faction as Faction | undefined;
      if (clickedFaction === 'enemy') {
        for (const unitId of selectedUnitIds) {
          sendCommand(socket, { type: 'attack', unitId, targetId: clickedUnitId });
        }
      } else {
        selectedUnitIds.clear();
        selectedUnitIds.add(clickedUnitId);
      }
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

// Auf Touch-Geraeten (iPad!) beendet das System eine Beruehrung auch per
// pointercancel statt pointerup, z. B. bei Systemgesten oder App-Wechsel -
// ohne diesen Handler bliebe der Drag-/Pinch-Zustand dann haengen.
renderer.domElement.addEventListener('pointercancel', (event) => {
  activePointers.delete(event.pointerId);
  pinchDistance = activePointers.size === 2 ? distanceBetweenPointers() : null;
  if (drag && event.pointerId === drag.pointerId) {
    drag = null;
  }
});

// Tastatur-Kamerasteuerung fuer Tests ohne Touch-Geraet: WASD schwenkt,
// Q/E dreht, R/F neigt. Nur unmodifizierte Tasten (docs/KONZEPT.md
// Abschnitt 5.2), Zuordnung Taste->Achse steckt in input/hotkeys.ts.
// Terminal-Fokus-Schutz kommt erst mit dem Terminal-Widget in Phase 3.
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

// Winkel muessen ueber die kuerzeste Differenz interpoliert werden: heading
// kommt aus atan2 (-PI..PI), und beim Ueberschreiten dieser Grenze (z. B.
// +3.1 -> -3.1) wuerde ein naives lerp durch fast 2*PI laufen - die Einheit
// dreht dann sichtbar eine fast volle Runde in die falsche Richtung.
function lerpAngle(a: number, b: number, t: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
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
    heading: lerpAngle(previous.heading, current.heading, t),
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
  const cameraInput = resolveCameraInput(pressedKeys);
  if (cameraInput.panForward !== 0 || cameraInput.panRight !== 0) {
    const { forward, right } = getGroundAxes(cameraRig);
    const length = Math.hypot(cameraInput.panForward, cameraInput.panRight);
    const stepForward = (cameraInput.panForward / length) * CAMERA_PAN_SPEED * deltaSeconds;
    const stepRight = (cameraInput.panRight / length) * CAMERA_PAN_SPEED * deltaSeconds;
    panCamera(
      cameraRig,
      forward.x * stepForward + right.x * stepRight,
      forward.y * stepForward + right.y * stepRight,
    );
  }

  if (cameraInput.rotate !== 0) rotateCamera(cameraRig, cameraInput.rotate * CAMERA_ROTATE_SPEED * deltaSeconds);
  if (cameraInput.tilt !== 0) tiltCamera(cameraRig, cameraInput.tilt * CAMERA_TILT_SPEED * deltaSeconds);

  // Path-Tracker: zeigt die verbleibende Route der ausgewaehlten Einheit
  // (docs/KONZEPT.md Abschnitt 5.3). Wird unten im Entity-Loop befuellt,
  // sobald die ausgewaehlte Einheit an der Reihe ist, und danach einmalig
  // auf die wiederverwendete Linie angewandt.
  let selectedPathPoints: THREE.Vector3[] = [];

  if (latestSnapshot) {
    for (const [id, snapshot] of latestSnapshot.entities) {
      let mesh = unitMeshes.get(id);
      if (!mesh) {
        mesh = createUnitMesh(snapshot.unitType, snapshot.faction);
        mesh.userData.unitId = id;
        mesh.userData.faction = snapshot.faction;
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
  updateTracers(now);

  renderer.render(scene, camera);
}

render();
