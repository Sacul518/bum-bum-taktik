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
  const raised = groundPoints.map((point) => new THREE.Vector3(point.x, point.y + HEIGHT_OFFSET, point.z));
  line.geometry.setFromPoints(raised);
  line.visible = true;
}
