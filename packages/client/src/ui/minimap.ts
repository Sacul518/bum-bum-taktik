import { TERRAIN_TYPES, type TerrainType, type BuildingFaction, type BuildingSnapshot, type EntitySnapshot, type Faction } from '@bum-bum-taktik/shared';
import { TERRAIN_COLORS } from '../render/terrain.js';

// Radar-Minimap (docs/KONZEPT.md Abschnitt 4 "Radar: HUD-Blips auf separatem
// 2D-Overlay" + Abschnitt 9 Phase 2 "Basis-Radar"): eigenes <canvas> im
// Bildschirmraum, kein Bezug zur 3D-Kamera - dieselbe Idee wie das
// In-Game-Terminal (terminal/Terminal.ts), nur ohne dessen Fenster-Chrome.
// Seit PLAN.md Session A Aufgabe 2 auch Navigations-Instrument: Klick/Ziehen
// zentriert die Kamera (wie in MMOs/LoL), dazu Kamera-Ausschnitt als Rechteck
// und Gebaeude als Quadrate.
const SIZE_CSS_PX = 180;
const BLIP_RADIUS = 2.5;
const BUILDING_SIZE = 4;
const GREEN = '#33ff33';

const BLIP_COLOR: Record<Faction, string> = {
  player: GREEN,
  enemy: '#ff4444',
};

const BUILDING_COLOR: Record<BuildingFaction, string> = {
  player: GREEN,
  enemy: '#ff4444',
  neutral: '#b5b5b5',
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

type MinimapUnit = Pick<EntitySnapshot, 'x' | 'y' | 'faction'>;
type MinimapBuilding = Pick<BuildingSnapshot, 'x' | 'y' | 'faction'>;

// Frustum-Ecken auf der Bodenebene, Reihenfolge im Umlaufsinn
// (render/camera.ts getGroundViewportCorners).
export type ViewportCorners = ReadonlyArray<{ x: number; z: number }>;

export interface Minimap {
  setTerrain(mapWidth: number, mapHeight: number, terrainTypes: Uint8Array): void;
  update(units: ReadonlyArray<MinimapUnit>, buildings?: ReadonlyArray<MinimapBuilding>): void;
  setViewport(corners: ViewportCorners): void;
  dispose(): void;
}

export function createMinimap(parent: HTMLElement, onNavigate?: (worldX: number, worldZ: number) => void): Minimap {
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
    // Kein Browser-Scrolling/Zoomen waehrend des Navigations-Drags (Touch).
    touchAction: 'none',
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
  // Letzter Stand fuer Neuzeichnungen zwischen den Server-Ticks - der
  // Kamera-Ausschnitt (setViewport) aendert sich pro Frame, die Einheiten
  // nur pro Tick (12 Hz, main.ts).
  let latestUnits: ReadonlyArray<MinimapUnit> = [];
  let latestBuildings: ReadonlyArray<MinimapBuilding> = [];
  let viewportCorners: ViewportCorners = [];

  function toCanvasX(worldX: number): number {
    return ((worldX + currentMapWidth / 2) / currentMapWidth) * SIZE_CSS_PX;
  }

  function toCanvasY(worldZ: number): number {
    return ((worldZ + currentMapHeight / 2) / currentMapHeight) * SIZE_CSS_PX;
  }

  function setTerrain(mapWidth: number, mapHeight: number, terrainTypes: Uint8Array): void {
    currentMapWidth = mapWidth;
    currentMapHeight = mapHeight;
    hasTerrain = true;
    // Blips/Gebaeude der alten Karte nicht in die neue hineinzeichnen - der
    // naechste Server-Tick liefert den frischen Stand.
    latestUnits = [];
    latestBuildings = [];

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

    render();
  }

  function render(): void {
    ctx.clearRect(0, 0, SIZE_CSS_PX, SIZE_CSS_PX);
    if (!hasTerrain || currentMapWidth === 0 || currentMapHeight === 0) return;
    ctx.drawImage(background, 0, 0, SIZE_CSS_PX, SIZE_CSS_PX);

    // Gebaeude zuerst, damit Einheiten-Blips darueber sichtbar bleiben.
    for (const building of latestBuildings) {
      ctx.fillStyle = BUILDING_COLOR[building.faction];
      ctx.fillRect(toCanvasX(building.x) - BUILDING_SIZE / 2, toCanvasY(building.y) - BUILDING_SIZE / 2, BUILDING_SIZE, BUILDING_SIZE);
    }

    for (const unit of latestUnits) {
      ctx.fillStyle = BLIP_COLOR[unit.faction];
      ctx.beginPath();
      ctx.arc(toCanvasX(unit.x), toCanvasY(unit.y), BLIP_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Kamera-Ausschnitt als umlaufende Linie; Ecken ausserhalb der Karte
    // schneidet das Canvas von selbst ab.
    if (viewportCorners.length >= 3) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      viewportCorners.forEach((corner, index) => {
        if (index === 0) ctx.moveTo(toCanvasX(corner.x), toCanvasY(corner.z));
        else ctx.lineTo(toCanvasX(corner.x), toCanvasY(corner.z));
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  function update(units: ReadonlyArray<MinimapUnit>, buildings: ReadonlyArray<MinimapBuilding> = []): void {
    latestUnits = units;
    latestBuildings = buildings;
    render();
  }

  function setViewport(corners: ViewportCorners): void {
    // Nur neu zeichnen, wenn sich der Ausschnitt wirklich bewegt hat - sonst
    // wuerde die Minimap bei stehender Kamera in jedem Frame neu gerendert
    // (Batterie/GPU, laeuft auch auf iPad).
    const unchanged =
      corners.length === viewportCorners.length &&
      corners.every((corner, index) => {
        const previous = viewportCorners[index];
        return previous !== undefined && Math.abs(corner.x - previous.x) < 0.01 && Math.abs(corner.z - previous.z) < 0.01;
      });
    if (unchanged) return;
    viewportCorners = corners.map((corner) => ({ x: corner.x, z: corner.z }));
    render();
  }

  // Klick und Ziehen zentrieren die Kamera auf die entsprechende Weltposition
  // (Umkehrung von toCanvasX/Y). Pointer-Capture haelt den Drag auch, wenn
  // der Zeiger die Minimap dabei verlaesst.
  let navigating = false;

  function navigateTo(event: PointerEvent): void {
    if (!onNavigate || !hasTerrain) return;
    const rect = canvas.getBoundingClientRect();
    const px = Math.min(Math.max(event.clientX - rect.left, 0), SIZE_CSS_PX);
    const py = Math.min(Math.max(event.clientY - rect.top, 0), SIZE_CSS_PX);
    onNavigate((px / SIZE_CSS_PX) * currentMapWidth - currentMapWidth / 2, (py / SIZE_CSS_PX) * currentMapHeight - currentMapHeight / 2);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!onNavigate) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    navigating = true;
    navigateTo(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (navigating) navigateTo(event);
  });
  const endNavigation = (): void => {
    navigating = false;
  };
  canvas.addEventListener('pointerup', endNavigation);
  canvas.addEventListener('pointercancel', endNavigation);

  function dispose(): void {
    canvas.remove();
  }

  return { setTerrain, update, setViewport, dispose };
}
