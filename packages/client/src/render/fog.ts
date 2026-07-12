import * as THREE from 'three';
import { VISION_RANGE, type EntitySnapshot } from '@bum-bum-taktik/shared';
import { HEIGHT_SCALE } from './terrain.js';

// Fog of War (docs/KONZEPT.md Abschnitt 9, Phase 2): eine Ebene ueber der
// ganzen Karte, die ausserhalb der Sichtkreise verdunkelt. Bewusst nur zwei
// Zustaende (kein "erkundet"-Gedaechtnis) - der Server schickt ohnehin nur
// Feind-Einheiten, die gerade sichtbar sind (protocol.ts), "unsichtbar"
// heisst hier also wirklich "koennte gerade alles sein".
const DARK_ALPHA = 0.45;
const DARK_ALPHA_BYTE = Math.round(DARK_ALPHA * 255);

// Knapp ueber der hoechstmoeglichen Kachelhoehe (Elevation bis 1.0 * HEIGHT_SCALE,
// siehe render/terrain.ts), damit die Ebene garantiert ueber jedem Gelaende
// jedes Presets liegt.
const HEIGHT_ABOVE_TERRAIN = 0.5;

export interface FogOverlay {
  mesh: THREE.Mesh;
  update(units: ReadonlyArray<Pick<EntitySnapshot, 'x' | 'y' | 'unitType' | 'faction'>>): void;
  dispose(): void;
}

export function createFogOverlay(mapWidth: number, mapHeight: number): FogOverlay {
  // Ein Texel pro Kachel, RGBA: R/G/B bleiben immer 0 (schwarz), nur Alpha
  // traegt die Verdunkelung. MeshBasicMaterial.map multipliziert Farbe UND
  // Alpha des Diffuse-Colors (map_fragment-Shaderchunk) - ein reiner
  // Alpha-Kanal (THREE.AlphaFormat) waere in WebGL2 nicht mehr zuverlaessig
  // unterstuetzt, RGBA ist der robuste Standardweg.
  const data = new Uint8Array(mapWidth * mapHeight * 4);

  const texture = new THREE.DataTexture(data, mapWidth, mapHeight, THREE.RGBAFormat, THREE.UnsignedByteType);
  // LinearFilter statt NearestFilter: weiche Kanten am Sichtkreis-Rand statt
  // hart sichtbarer Kachel-Bloecke.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  // PlaneGeometry deckt exakt denselben Weltbereich ab wie das Terrain-Mesh
  // (render/terrain.ts: Weltursprung = Kartenmitte, x/z in [-width/2, width/2]
  // bzw. [-height/2, height/2]). Nach der Rotation unten passen die
  // Standard-UVs von PlaneGeometry exakt auf Kachel-Zeilen/-Spalten (Zeile 0
  // des Texturdatenarrays liegt an z = -height/2) - keine manuelle
  // UV-Anpassung noetig.
  const geometry = new THREE.PlaneGeometry(mapWidth, mapHeight);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Flach auf den Boden legen, wie die Einheiten-Sprites (render/units.ts).
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = HEIGHT_SCALE + HEIGHT_ABOVE_TERRAIN;
  // Ueber Terrain UND Einheiten (siehe Bericht: Annahme, weil main.ts hier
  // nicht verdrahtet wird) - Einheiten bleiben trotzdem lesbar, weil sie
  // erst opak in den Farb-/Tiefenpuffer gezeichnet werden (Terrain-/
  // Einheiten-Pass) und die Fog-Ebene danach nur transparent darueberblendet.
  mesh.renderOrder = 10;

  function update(units: ReadonlyArray<Pick<EntitySnapshot, 'x' | 'y' | 'unitType' | 'faction'>>): void {
    // Erst alles verdunkeln - nur die Alpha-Bytes anfassen, R/G/B bleiben 0.
    for (let i = 3; i < data.length; i += 4) data[i] = DARK_ALPHA_BYTE;

    for (const unit of units) {
      if (unit.faction !== 'player') continue;
      const radius = VISION_RANGE[unit.unitType];

      // Weltkoordinaten -> Kachel-Raum (gleiche Konvention wie
      // sampleElevation() in render/terrain.ts), als Fliesskommazahl fuer
      // den praezisen euklidischen Kreistest.
      const cx = unit.x + mapWidth / 2;
      const cy = unit.y + mapHeight / 2;
      const radiusSq = radius * radius;

      // Nur den Bounding-Box-Bereich der Einheit durchlaufen, nicht die
      // ganze Karte - wichtig fuer die Performance bei mehreren Dutzend
      // Einheiten auf einer 500x500-Karte.
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(mapWidth - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(mapHeight - 1, Math.ceil(cy + radius));

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const dx = tx + 0.5 - cx;
          const dy = ty + 0.5 - cy;
          if (dx * dx + dy * dy > radiusSq) continue;
          data[(ty * mapWidth + tx) * 4 + 3] = 0;
        }
      }
    }

    texture.needsUpdate = true;
  }

  function dispose(): void {
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { mesh, update, dispose };
}
