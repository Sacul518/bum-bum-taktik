import * as THREE from 'three';
import type { UnitType } from '@bum-bum-taktik/shared';
import tankSpriteUrl from '../../../../assets/sprites/land/tank.png';
import infantrySpriteUrl from '../../../../assets/sprites/infantry/infantry.png';

// Textur-Atlas fuer Einheiten-Sprites (docs/KONZEPT.md Abschnitte 4 und 7):
// alle Einheitentypen liegen als Kacheln in EINER Textur, damit saemtliche
// Einheiten dasselbe Material teilen koennen - Voraussetzung fuer das spaeter
// geplante Sprite-Instancing (ein Draw-Call pro Einheitentyp).
//
// tank und infantry nutzen inzwischen echte CC0-Sprites (siehe
// assets/ATTRIBUTION.md). boat/plane sind noch Platzhalter, die beim Start
// in dasselbe Canvas gezeichnet werden - fuer Schiffe/Flugzeuge ist noch
// keine CC0-Quelle bestaetigt (KONZEPT Abschnitt 7: nicht raten!). Sobald
// weitere Assets ausgewaehlt sind, reicht ein weiterer REAL_SPRITES-Eintrag
// unten - Regionen-Zuordnung und units.ts bleiben unveraendert.

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

// tank und infantry haben jetzt echte Sprites (siehe REAL_SPRITES) und
// brauchen deshalb keinen Eintrag mehr in dieser Platzhalter-Tabelle.
const SPRITE_DRAWERS: Record<Exclude<UnitType, 'tank' | 'infantry'>, (ctx: CanvasRenderingContext2D) => void> = {
  boat: drawBoat,
  plane: drawPlane,
};

// Echte Sprite-Bilder je Einheitentyp, mit der Drehung, die noetig ist, um
// die Quelle auf unsere Konvention "Fahrtrichtung nach rechts" zu bringen
// (siehe Kommentar oben). rotation in Radiant, im Uhrzeigersinn.
const REAL_SPRITES: Partial<Record<UnitType, { url: string; rotation: number }>> = {
  // Kenneys Panzer zeigt den Kanonenlauf nach unten (+Canvas-y) -> -90°.
  tank: { url: tankSpriteUrl, rotation: -Math.PI / 2 },
  // PixVoxel face3 zeigt bereits nach rechts -> keine Drehung noetig.
  infantry: { url: infantrySpriteUrl, rotation: 0 },
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Sprite konnte nicht geladen werden: ${url}`));
    image.src = url;
  });
}

// Maximale Kantenlaenge, auf die ein echtes Sprite innerhalb einer Kachel
// herunterskaliert wird (Seitenverhaeltnis bleibt erhalten) - etwas kleiner
// als ATLAS_TILE_PX, damit auch nach der Rotation unten kein Rand in die
// Nachbarkachel hineinragt.
const SPRITE_FIT_PX = 52;

// Zeichnet ein geladenes Bild zentriert und auf SPRITE_FIT_PX herunterskaliert
// in die aktuelle (bereits per translate positionierte) Kachel-Mitte.
function drawFittedImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement): void {
  const scale = Math.min(SPRITE_FIT_PX / image.width, SPRITE_FIT_PX / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
}

/**
 * Zeichnet den Einheiten-Atlas einmalig in ein Canvas (echte Sprites +
 * verbleibende Platzhalter) und liefert ihn als Textur. Nur einmal pro
 * Anwendung aufrufen und die Textur teilen - siehe Material-Cache in
 * units.ts.
 */
export async function createUnitAtlasTexture(): Promise<THREE.Texture> {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH_PX;
  canvas.height = ATLAS_HEIGHT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D-Canvas-Kontext fuer den Einheiten-Atlas nicht verfuegbar');

  const realSpriteEntries = Object.entries(REAL_SPRITES) as [UnitType, { url: string; rotation: number }][];
  const realSpriteImages = await Promise.all(realSpriteEntries.map(([, sprite]) => loadImage(sprite.url)));

  realSpriteEntries.forEach(([unitType, sprite], index) => {
    ctx.save();
    ctx.translate(ATLAS_COLUMN[unitType] * ATLAS_TILE_PX + ATLAS_TILE_PX / 2, ATLAS_TILE_PX / 2);
    ctx.rotate(sprite.rotation);
    drawFittedImage(ctx, realSpriteImages[index]!);
    ctx.restore();
  });

  for (const unitType of Object.keys(SPRITE_DRAWERS) as Exclude<UnitType, 'tank' | 'infantry'>[]) {
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
