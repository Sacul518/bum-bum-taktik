import * as THREE from 'three';
import type { UnitType } from '@bum-bum-taktik/shared';

// Textur-Atlas fuer Einheiten-Sprites (docs/KONZEPT.md Abschnitte 4 und 7):
// alle Einheitentypen liegen als Kacheln in EINER Textur, damit saemtliche
// Einheiten dasselbe Material teilen koennen - Voraussetzung fuer das spaeter
// geplante Sprite-Instancing (ein Draw-Call pro Einheitentyp).
//
// Die Sprites sind aktuell Platzhalter, die beim Start in ein Canvas
// gezeichnet werden. Fuer Schiffe/Flugzeuge ist noch keine CC0-Quelle
// bestaetigt (KONZEPT Abschnitt 7: nicht raten!). Sobald echte Assets
// ausgewaehlt sind, ersetzt ein per THREE.TextureLoader geladenes PNG mit
// demselben Kachel-Layout nur createUnitAtlasTexture() - Regionen-Zuordnung
// und units.ts bleiben unveraendert.

/** Kantenlaenge einer Atlas-Kachel in Pixeln. */
export const ATLAS_TILE_PX = 64;

// Spalte jedes Einheitentyps im Atlas (eine Zeile mit 4 Kacheln).
const ATLAS_COLUMN: Record<UnitType, number> = {
  tank: 0,
  infantry: 1,
  boat: 2,
  plane: 3,
};

const ATLAS_COLUMN_COUNT = 4;
const ATLAS_WIDTH_PX = ATLAS_TILE_PX * ATLAS_COLUMN_COUNT;
const ATLAS_HEIGHT_PX = ATLAS_TILE_PX;

/** UV-Rechteck einer Atlas-Kachel (u0/v0 = links unten, u1/v1 = rechts oben). */
export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export function getUnitUvRect(unitType: UnitType): UvRect {
  const column = ATLAS_COLUMN[unitType];
  return {
    u0: column / ATLAS_COLUMN_COUNT,
    u1: (column + 1) / ATLAS_COLUMN_COUNT,
    v0: 0,
    v1: 1,
  };
}

// Alle Zeichenfunktionen malen in Draufsicht mit Fahrtrichtung nach rechts
// (+Canvas-x). Zusammen mit dem UV-Mapping in units.ts zeigt ein Sprite mit
// heading 0 dadurch in Welt-+X - dieselbe Konvention wie die bisherige
// Platzhalter-Geometrie (applySnapshot dreht die Gruppe um heading).
// Der Ursprung liegt beim Aufruf jeweils in der Kachelmitte.

function drawTank(ctx: CanvasRenderingContext2D): void {
  // Ketten oben/unten, Wanne, Turm mit Rohr nach rechts.
  ctx.fillStyle = '#1e5c28';
  ctx.fillRect(-24, -22, 48, 10);
  ctx.fillRect(-24, 12, 48, 10);
  ctx.fillStyle = '#2f8f3d';
  ctx.fillRect(-22, -14, 44, 28);
  ctx.fillStyle = '#256e31';
  ctx.beginPath();
  ctx.arc(-2, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-2, -3, 28, 6);
}

function drawInfantry(ctx: CanvasRenderingContext2D): void {
  // Koerper mit Schultern, Helm, angedeutete Waffe nach rechts.
  ctx.fillStyle = '#1b4fa8';
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2266dd';
  ctx.beginPath();
  ctx.arc(2, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#163c7d';
  ctx.fillRect(4, -2, 18, 4);
}

function drawBoat(ctx: CanvasRenderingContext2D): void {
  // Rumpf mit spitzem Bug nach rechts, Aufbau als helleres Deckshaus.
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(12, -10);
  ctx.lineTo(-24, -10);
  ctx.lineTo(-28, 0);
  ctx.lineTo(-24, 10);
  ctx.lineTo(12, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(-14, -5, 20, 10);
}

function drawPlane(ctx: CanvasRenderingContext2D): void {
  // Rumpf, gepfeilte Tragflaechen, Heckleitwerk - Nase nach rechts.
  ctx.fillStyle = '#dd2222';
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(18, -4);
  ctx.lineTo(-22, -4);
  ctx.lineTo(-26, 0);
  ctx.lineTo(-22, 4);
  ctx.lineTo(18, 4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-10, -24);
  ctx.lineTo(-16, -24);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-16, 24);
  ctx.lineTo(-10, 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a81a1a';
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-26, -10);
  ctx.lineTo(-26, 10);
  ctx.closePath();
  ctx.fill();
}

const SPRITE_DRAWERS: Record<UnitType, (ctx: CanvasRenderingContext2D) => void> = {
  tank: drawTank,
  infantry: drawInfantry,
  boat: drawBoat,
  plane: drawPlane,
};

/**
 * Zeichnet den Platzhalter-Atlas einmalig in ein Canvas und liefert ihn als
 * Textur. Nur einmal pro Anwendung aufrufen und die Textur teilen - siehe
 * Material-Cache in units.ts.
 */
export function createUnitAtlasTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH_PX;
  canvas.height = ATLAS_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D-Canvas-Kontext fuer den Einheiten-Atlas nicht verfuegbar');

  for (const unitType of Object.keys(SPRITE_DRAWERS) as UnitType[]) {
    ctx.save();
    ctx.translate(ATLAS_COLUMN[unitType] * ATLAS_TILE_PX + ATLAS_TILE_PX / 2, ATLAS_TILE_PX / 2);
    SPRITE_DRAWERS[unitType](ctx);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Platzhalter (spaeter Pixel-Art) sollen beim Heranzoomen scharfkantig
  // bleiben statt zu verwaschen.
  texture.magFilter = THREE.NearestFilter;
  return texture;
}
