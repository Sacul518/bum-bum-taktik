import * as THREE from 'three';
import type { ShotEvent } from '@bum-bum-taktik/shared';

// Simple Tracer-Linie pro Schuss (docs/KONZEPT.md Abschnitt 9, Phase 2):
// blitzt kurz vom Schuetzen zum Ziel auf und verschwindet wieder. Bewusst
// nur eine Linie, keine Projektil-Animation - Grafik-Feinschliff ist Phase 4.
// Lang genug, dass der Spieler erkennt, wer auf wen schiesst - 150ms waren
// im Test praktisch unsichtbar.
const TRACER_LIFETIME_MS = 300;
const HEIGHT_OFFSET = 0.6; // Linie schwebt knapp ueber den Sprites, nicht im Boden

const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffdd55 });

interface ActiveTracer {
  line: THREE.Line;
  expiresAt: number;
}

const activeTracers: ActiveTracer[] = [];

export function spawnTracer(parent: THREE.Object3D, shot: ShotEvent, fromHeight: number, toHeight: number): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(shot.fromX, fromHeight + HEIGHT_OFFSET, shot.fromY),
    new THREE.Vector3(shot.toX, toHeight + HEIGHT_OFFSET, shot.toY),
  ]);
  const line = new THREE.Line(geometry, tracerMaterial);
  parent.add(line);
  activeTracers.push({ line, expiresAt: performance.now() + TRACER_LIFETIME_MS });
}

/** Einmal pro Frame aufrufen: entfernt abgelaufene Tracer-Linien. */
export function updateTracers(now: number): void {
  for (let i = activeTracers.length - 1; i >= 0; i--) {
    const tracer = activeTracers[i]!;
    if (now < tracer.expiresAt) continue;
    tracer.line.parent?.remove(tracer.line);
    tracer.line.geometry.dispose();
    activeTracers.splice(i, 1);
  }
}
