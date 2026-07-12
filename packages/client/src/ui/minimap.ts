import { TERRAIN_TYPES, type TerrainType, type EntitySnapshot, type Faction } from '@bum-bum-taktik/shared';
import { TERRAIN_COLORS } from '../render/terrain.js';

// Radar-Minimap (docs/KONZEPT.md Abschnitt 4 "Radar: HUD-Blips auf separatem
// 2D-Overlay" + Abschnitt 9 Phase 2 "Basis-Radar"): eigenes <canvas> im
// Bildschirmraum, kein Bezug zur 3D-Kamera - dieselbe Idee wie das
// In-Game-Terminal (terminal/Terminal.ts), nur ohne dessen Fenster-Chrome.
const SIZE_CSS_PX = 180;
const BLIP_RADIUS = 2.5;
const GREEN = '#33ff33';

const BLIP_COLOR: Record<Faction, string> = {
  player: GREEN,
  enemy: '#ff4444',
};

// Einmal pro Terrain-Typ vorab in einen CSS-Hex-String umgewandelt (statt bei
// jedem der bis zu einigen Hunderttausend Downsample-Pixel neu zu rechnen) -
// noetig, weil THREE.Color intern linear speichert und getHexString() die
// sRGB-Rueckrechnung fuers <canvas> uebernimmt (dieselben Farben wie das
// 3D-Terrain, render/terrain.ts).
const TERRAIN_CSS_COLORS = {} as Record<TerrainType, string>;
for (const type of TERRAIN_TYPES) {
  TERRAIN_CSS_COLORS[type] = `#${TERRAIN_COLORS[type].getHexString()}`;
}

export interface Minimap {
  setTerrain(mapWidth: number, mapHeight: number, terrainTypes: Uint8Array): void;
  update(units: ReadonlyArray<Pick<EntitySnapshot, 'x' | 'y' | 'faction'>>): void;
  dispose(): void;
}

export function createMinimap(parent: HTMLElement): Minimap {
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE_CSS_PX * dpr;
  canvas.height = SIZE_CSS_PX * dpr;
  Object.assign(canvas.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    width: `${SIZE_CSS_PX}px`,
    height: `${SIZE_CSS_PX}px`,
    background: 'rgba(5, 10, 5, 0.85)',
    border: '1px solid rgba(51, 255, 51, 0.55)',
    borderRadius: '6px',
    boxShadow: '0 0 12px rgba(51, 255, 51, 0.25)',
    zIndex: '5',
  } satisfies Partial<CSSStyleDeclaration>);
  parent.appendChild(canvas);

  // Zwischenvariable + eigene const-Zuweisung noetig, damit die Narrowing
  // (nicht mehr null) auch innerhalb der unten verschachtelten Funktionen
  // gilt - TypeScript verwirft Narrowing von Closures sonst am Funktionsrand.
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('2D-Context fuer Minimap nicht verfuegbar');
  const ctx = ctxOrNull;
  // Ab hier in CSS-Pixeln zeichnen (0..SIZE_CSS_PX) statt in Geraete-Pixeln -
  // die devicePixelRatio-Aufloesung oben sorgt trotzdem fuer scharfe Kanten.
  ctx.scale(dpr, dpr);

  // Terrain-Hintergrund nur bei setTerrain() (Kartenwechsel) neu zeichnen,
  // nicht pro Tick - eigenes Offscreen-Canvas in derselben Geraete-Aufloesung
  // wie das sichtbare Canvas, damit drawImage() in render() nicht zusaetzlich
  // hoch-/runterskaliert.
  const background = document.createElement('canvas');
  background.width = canvas.width;
  background.height = canvas.height;
  const backgroundCtxOrNull = background.getContext('2d');
  if (!backgroundCtxOrNull) throw new Error('2D-Context fuer Minimap-Hintergrund nicht verfuegbar');
  const backgroundCtx = backgroundCtxOrNull;

  let hasTerrain = false;
  let currentMapWidth = 0;
  let currentMapHeight = 0;

  function setTerrain(mapWidth: number, mapHeight: number, terrainTypes: Uint8Array): void {
    currentMapWidth = mapWidth;
    currentMapHeight = mapHeight;
    hasTerrain = true;

    const resX = background.width;
    const resY = background.height;
    for (let py = 0; py < resY; py++) {
      const ty = Math.min(mapHeight - 1, Math.floor((py / resY) * mapHeight));
      for (let px = 0; px < resX; px++) {
        const tx = Math.min(mapWidth - 1, Math.floor((px / resX) * mapWidth));
        const type = TERRAIN_TYPES[terrainTypes[ty * mapWidth + tx] as number] as TerrainType;
        backgroundCtx.fillStyle = TERRAIN_CSS_COLORS[type];
        backgroundCtx.fillRect(px, py, 1, 1);
      }
    }

    render([]);
  }

  function render(units: ReadonlyArray<Pick<EntitySnapshot, 'x' | 'y' | 'faction'>>): void {
    ctx.clearRect(0, 0, SIZE_CSS_PX, SIZE_CSS_PX);
    if (!hasTerrain || currentMapWidth === 0 || currentMapHeight === 0) return;
    ctx.drawImage(background, 0, 0, SIZE_CSS_PX, SIZE_CSS_PX);

    for (const unit of units) {
      const x = ((unit.x + currentMapWidth / 2) / currentMapWidth) * SIZE_CSS_PX;
      const y = ((unit.y + currentMapHeight / 2) / currentMapHeight) * SIZE_CSS_PX;
      ctx.fillStyle = BLIP_COLOR[unit.faction];
      ctx.beginPath();
      ctx.arc(x, y, BLIP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function dispose(): void {
    canvas.remove();
  }

  return { setTerrain, update: render, dispose };
}
