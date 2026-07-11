import * as THREE from 'three';

// Sichtbare Hoehe des Frustums in Weltkoordinaten. "Zoom" bedeutet bei einer
// orthografischen Kamera, diesen Wert zu aendern - NICHT die Kamera per
// Dolly naeher heranzufahren (siehe docs/KONZEPT.md Abschnitt 4).
const DEFAULT_VIEW_SIZE = 40;
// Karte ist 500x500 Weltkacheln (packages/server/src/index.ts). Grenzen so
// gewaehlt, dass man sowohl nah an einzelne Einheiten heran (10) als auch
// bis zur vollen Kartenbreite heraus (500) zoomen kann, ohne sie zu
// sprengen.
const MIN_VIEW_SIZE = 10;
const MAX_VIEW_SIZE = 500;

const DEFAULT_DISTANCE = Math.sqrt(3) * 50; // Betrag des urspruenglichen Versatzes (50,50,50)
const DEFAULT_AZIMUTH = Math.PI / 4; // 45°, wie zuvor die feste Position
const DEFAULT_TILT = Math.atan(1 / Math.SQRT2); // ~35.26°, wie zuvor
// Fast flacher Blick ist erlaubt (Nebel in scene.ts blendet die dabei
// zwangslaeufig komprimierte Ferne weich aus, statt hart am Kartenrand
// abzuschneiden). 0° exakt bleibt aussen vor, weil die Bodenflaeche dann auf
// eine Linie zusammenfaellt - das ist keine Rendering-Frage mehr, sondern
// jede Draufsicht auf eine flache Flaeche macht das bei exakt 0°.
const MIN_TILT = THREE.MathUtils.degToRad(8);
const MAX_TILT = THREE.MathUtils.degToRad(85);

// Kamera als Kugelkoordinaten um einen Zielpunkt auf dem Boden: azimuth
// (Drehung um die Karte), tilt (Neigung ueber dem Horizont), distance (fest,
// Zoom passiert ueber das Frustum, nicht ueber die Distanz). Dadurch bleiben
// Schwenken/Drehen/Neigen unabhaengig voneinander steuerbar.
export interface CameraRig {
  camera: THREE.OrthographicCamera;
  target: THREE.Vector3;
  azimuth: number;
  tilt: number;
  distance: number;
  viewSize: number;
  aspect: number;
}

export function createCameraRig(aspect: number): CameraRig {
  // near ist bewusst negativ: bei einer orthografischen Kamera ist das
  // erlaubt und noetig, weil beim weiten Herauszoomen (viewSize > ~120)
  // Bodenflaechen am unteren Bildrand geometrisch HINTER der Kameraposition
  // liegen - mit near >= 0 wuerden sie von der Near-Plane weggeschnitten.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);

  const rig: CameraRig = {
    camera,
    target: new THREE.Vector3(0, 0, 0),
    azimuth: DEFAULT_AZIMUTH,
    tilt: DEFAULT_TILT,
    distance: DEFAULT_DISTANCE,
    viewSize: DEFAULT_VIEW_SIZE,
    aspect,
  };
  updateCameraFrustum(rig);
  updateCameraTransform(rig);
  return rig;
}

// Setzt das Frustum (left/right/top/bottom) aus viewSize + aspect neu -
// gemeinsamer Weg fuer Fenstergroessen-Aenderungen (Aspect) und Zoom
// (viewSize), da beide dieselben vier Werte beeinflussen.
function updateCameraFrustum(rig: CameraRig): void {
  rig.camera.left = (-rig.viewSize * rig.aspect) / 2;
  rig.camera.right = (rig.viewSize * rig.aspect) / 2;
  rig.camera.top = rig.viewSize / 2;
  rig.camera.bottom = -rig.viewSize / 2;
  rig.camera.updateProjectionMatrix();
}

export function updateCameraAspect(rig: CameraRig, aspect: number): void {
  rig.aspect = aspect;
  updateCameraFrustum(rig);
}

// factor > 1 zoomt heraus (groesserer Ausschnitt), factor < 1 zoomt heran -
// dieselbe Konvention wie WheelEvent.deltaY (positiv = vom Nutzer weg
// gescrollt = herauszoomen).
export function zoomCamera(rig: CameraRig, factor: number): void {
  rig.viewSize = THREE.MathUtils.clamp(rig.viewSize * factor, MIN_VIEW_SIZE, MAX_VIEW_SIZE);
  updateCameraFrustum(rig);
}

function updateCameraTransform(rig: CameraRig): void {
  const horizontal = rig.distance * Math.cos(rig.tilt);
  rig.camera.position.set(
    rig.target.x + horizontal * Math.cos(rig.azimuth),
    rig.target.y + rig.distance * Math.sin(rig.tilt),
    rig.target.z + horizontal * Math.sin(rig.azimuth),
  );
  rig.camera.lookAt(rig.target);
}

// Zurueck auf die Startansicht (Kartenmitte, Standard-Zoom und -Winkel):
// nach einem Kartenwechsel ergibt die alte Kameraposition auf der neuen
// Karte keinen Sinn mehr.
export function resetCamera(rig: CameraRig): void {
  rig.target.set(0, 0, 0);
  rig.azimuth = DEFAULT_AZIMUTH;
  rig.tilt = DEFAULT_TILT;
  rig.viewSize = DEFAULT_VIEW_SIZE;
  updateCameraFrustum(rig);
  updateCameraTransform(rig);
}

export function panCamera(rig: CameraRig, deltaX: number, deltaZ: number): void {
  rig.target.x += deltaX;
  rig.target.z += deltaZ;
  updateCameraTransform(rig);
}

export function rotateCamera(rig: CameraRig, deltaAzimuth: number): void {
  rig.azimuth += deltaAzimuth;
  updateCameraTransform(rig);
}

export function tiltCamera(rig: CameraRig, deltaTilt: number): void {
  rig.tilt = THREE.MathUtils.clamp(rig.tilt + deltaTilt, MIN_TILT, MAX_TILT);
  updateCameraTransform(rig);
}

// Perspektivabhaengige Bewegungsachsen auf der Bodenebene: "vorwaerts" zeigt
// dahin, wo die Kamera gerade hinschaut - nicht entlang der Weltachsen.
// Dadurch bleibt WASD nach einer Drehung (rotateCamera) weiterhin
// bildschirmrelativ statt kartenrelativ (siehe Ruecksprache mit Lucas).
export function getGroundAxes(rig: CameraRig): { forward: THREE.Vector2; right: THREE.Vector2 } {
  const forward = new THREE.Vector2(-Math.cos(rig.azimuth), -Math.sin(rig.azimuth));
  const right = new THREE.Vector2(-forward.y, forward.x);
  return { forward, right };
}
