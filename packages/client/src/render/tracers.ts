import * as THREE from 'three';
import type { ProjectileKind, ShotEvent } from '@bum-bum-taktik/shared';

// Simple Tracer-Linie pro Schuss (docs/KONZEPT.md Abschnitt 9, Phase 2):
// blitzt kurz vom Schuetzen zum Ziel auf und verschwindet wieder. Bewusst
// nur eine Linie, keine Projektil-Animation - Grafik-Feinschliff ist Phase 4.
// Lang genug, dass der Spieler erkennt, wer auf wen schiesst - 150ms waren
// im Test praktisch unsichtbar. Farbe und Standzeit haengen am Projektiltyp
// aus dem Waffenprofil (WEAPONS in shared/constants.ts), damit man Kanonen,
// MG-Feuer und Raketen auseinanderhalten kann.
const HEIGHT_OFFSET = 0.6; // Linie schwebt knapp ueber den Modellen, nicht im Boden

const TRACER_STYLE: Record<ProjectileKind, { color: number; lifetimeMs: number }> = {
  shell: { color: 0xffaa33, lifetimeMs: 300 }, // Kanone/Schiffsgeschuetz: orange
  bullet: { color: 0xffee88, lifetimeMs: 180 }, // Sturmgewehr: kurz, hellgelb
  rocket: { color: 0xff5533, lifetimeMs: 380 }, // Raketen: rot, laenger sichtbar
  flak: { color: 0x88ddff, lifetimeMs: 250 }, // Flak (Tuerme, spaeter): hellblau
};

const tracerMaterials = new Map<ProjectileKind, THREE.LineBasicMaterial>();

function getTracerMaterial(kind: ProjectileKind): THREE.LineBasicMaterial {
  let cached = tracerMaterials.get(kind);
  if (!cached) {
    cached = new THREE.LineBasicMaterial({ color: TRACER_STYLE[kind].color });
    tracerMaterials.set(kind, cached);
  }
  return cached;
}

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
  const line = new THREE.Line(geometry, getTracerMaterial(shot.projectile));
  parent.add(line);
  activeTracers.push({ line, expiresAt: performance.now() + TRACER_STYLE[shot.projectile].lifetimeMs });
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
