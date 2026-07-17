import * as THREE from 'three';

// Zeigt die verbleibende Route der ausgewaehlten Einheit als Linie ueber dem
// Terrain an (docs/KONZEPT.md Abschnitt 5.3) - eine einzelne wiederverwendete
// Line, da aktuell immer nur eine Einheit gleichzeitig ausgewaehlt sein kann.
const HEIGHT_OFFSET = 0.1; // knapp ueber dem Terrain gegen Z-Fighting

export function createPathLine(): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({ color: 0xffee66 });
  const line = new THREE.Line(geometry, material);
  line.visible = false;
  return line;
}

export function updatePathLine(line: THREE.Line, groundPoints: THREE.Vector3[]): void {
  if (groundPoints.length < 2) {
    line.visible = false;
    return;
  }

  // setFromPoints() kann einen einmal angelegten Buffer nicht vergroessern:
  // wird der Pfad laenger als alle bisherigen, warnt Three.js in JEDEM Frame
  // ("Buffer size too small for points data") und zeichnet abgeschnitten.
  // Deshalb: eigenen Buffer mit Reserve verwalten und bei Bedarf gegen einen
  // groesseren tauschen; gezeichnet wird nur der befuellte Teil (DrawRange).
  let position = line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count < groundPoints.length) {
    let capacity = Math.max(position?.count ?? 0, 64);
    while (capacity < groundPoints.length) capacity *= 2;
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    line.geometry.setAttribute('position', position);
  }

  for (let i = 0; i < groundPoints.length; i++) {
    const point = groundPoints[i]!;
    position.setXYZ(i, point.x, point.y + HEIGHT_OFFSET, point.z);
  }
  position.needsUpdate = true;
  line.geometry.setDrawRange(0, groundPoints.length);
  // Ohne aktuelle Bounding-Sphere wuerde das Frustum-Culling die Linie
  // faelschlich ausblenden, sobald die alte (kleinere) Sphere ausserhalb liegt.
  line.geometry.computeBoundingSphere();
  line.visible = true;
}
