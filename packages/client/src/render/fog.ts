import * as THREE from 'three';
import { BUILDINGS, VISION_RANGE, type BuildingSnapshot, type EntitySnapshot, type ReconZone } from '@bum-bum-taktik/shared';

// Fog of War (docs/KONZEPT.md Abschnitt 9, Phase 2): Verdunkelung ausserhalb
// der Sichtkreise. Bewusst nur zwei Zustaende (kein "erkundet"-Gedaechtnis) -
// der Server schickt ohnehin nur Feind-Einheiten, die gerade sichtbar sind
// (protocol.ts), "unsichtbar" heisst hier also wirklich "koennte gerade alles
// sein".
//
// Die Verdunkelung sitzt seit dem FoW-Rework (PLAN.md Session A, Aufgabe 1)
// direkt in den Materialien von Terrain und Gebaeuden (onBeforeCompile-Hook,
// s. applyFogDarkening) statt auf einer separaten Ebene ueber der Karte: die
// Ebene schwebte auf fester Hoehe, bei geneigter Kamera schaute man am
// Kartenrand drunter durch.
const DARK_ALPHA = 0.45;
const DARK_ALPHA_BYTE = Math.round(DARK_ALPHA * 255);

// Uniforms, die sich alle gepatchten Materialien teilen. Bei einem
// Kartenwechsel tauscht createFogOverlay() nur die Werte aus - die Materialien
// (v. a. der geteilte Material-Cache in models.ts, der Kartenwechsel
// ueberlebt) muessen dafuer nicht neu kompiliert werden.
const fogMapUniform: THREE.IUniform<THREE.Texture | null> = { value: null };
const fogMapSizeUniform: THREE.IUniform<THREE.Vector2> = { value: new THREE.Vector2(1, 1) };
// 0 solange keine Karte da ist: der Shader sampelt dann zwar weiter die
// (ungebundene) Textur, multipliziert das Ergebnis aber mit 0 - so braucht es
// keine zweite Shader-Variante ohne Fog.
const fogEnabledUniform: THREE.IUniform<number> = { value: 0 };

// Haengt die Fog-Verdunkelung an ein Material: der Vertex-Shader rechnet die
// Welt-XZ-Position in Fog-Textur-UVs um, der Fragment-Shader dunkelt die
// fertige Fragmentfarbe um den Alpha-Wert der Textur ab. Injektionspunkte:
// <fog_vertex> ist der letzte Chunk im main() aller eingebauten
// Vertex-Shader (transformed ist dort noch in Scope), <dithering_fragment>
// der letzte im Fragment-Shader - die Abdunkelung wirkt damit nach Tone-
// Mapping/Farbraum, genau wie frueher das Blending der Ebene im Framebuffer.
export function applyFogDarkening(material: THREE.Material): void {
  if (material.userData.hasFogDarkening) return;
  material.userData.hasFogDarkening = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fogDarkMap = fogMapUniform;
    shader.uniforms.fogDarkMapSize = fogMapSizeUniform;
    shader.uniforms.fogDarkEnabled = fogEnabledUniform;
    shader.vertexShader =
      'uniform vec2 fogDarkMapSize;\nvarying vec2 vFogDarkUv;\n' +
      shader.vertexShader.replace(
        '#include <fog_vertex>',
        // Zeile 0 der DataTexture liegt an z = +height/2, die Zeilen laufen
        // GEGEN die Welt-Z-Richtung - dieselbe Spiegelung, die der
        // Sichtkreis-Stempel in punchCircle() rechnet (cy-Formel).
        '#include <fog_vertex>\n' +
          'vec4 fogDarkWorld = modelMatrix * vec4(transformed, 1.0);\n' +
          'vFogDarkUv = vec2(fogDarkWorld.x / fogDarkMapSize.x + 0.5, 0.5 - fogDarkWorld.z / fogDarkMapSize.y);',
      );
    shader.fragmentShader =
      'uniform sampler2D fogDarkMap;\nuniform float fogDarkEnabled;\nvarying vec2 vFogDarkUv;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        'gl_FragColor.rgb *= 1.0 - texture2D(fogDarkMap, vFogDarkUv).a * fogDarkEnabled;\n' +
          '#include <dithering_fragment>',
      );
  };
  material.needsUpdate = true;
}

export interface FogOverlay {
  update(
    units: ReadonlyArray<Pick<EntitySnapshot, 'x' | 'y' | 'unitType' | 'faction'>>,
    reconZones?: ReadonlyArray<ReconZone>,
    buildings?: ReadonlyArray<Pick<BuildingSnapshot, 'x' | 'y' | 'buildingType' | 'faction'>>,
  ): void;
  dispose(): void;
}

export function createFogOverlay(mapWidth: number, mapHeight: number): FogOverlay {
  // Ein Texel pro Kachel, RGBA: R/G/B bleiben immer 0, nur Alpha traegt die
  // Verdunkelung - der Shader-Hook liest ausschliesslich den Alpha-Kanal.
  const data = new Uint8Array(mapWidth * mapHeight * 4);

  const texture = new THREE.DataTexture(data, mapWidth, mapHeight, THREE.RGBAFormat, THREE.UnsignedByteType);
  // LinearFilter statt NearestFilter: weiche Kanten am Sichtkreis-Rand statt
  // hart sichtbarer Kachel-Bloecke.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  fogMapUniform.value = texture;
  fogMapSizeUniform.value.set(mapWidth, mapHeight);
  fogEnabledUniform.value = 1;

  // Stanzt einen aufgehellten Kreis in die Verdunkelung. Erwartet
  // Weltkoordinaten und rechnet sie in den Kachel-Raum um: X wie in
  // sampleElevation() (render/terrain.ts); Y gespiegelt, weil Textur-Zeile 0
  // an z = +height/2 liegt (siehe UV-Rechnung in applyFogDarkening). Ohne
  // diese Spiegelung landen die Kreise an der Z-gespiegelten Position der
  // Einheit (im Browser-Test 2026-07-12 genau so beobachtet).
  function punchCircle(worldX: number, worldY: number, radius: number): void {
    const cx = worldX + mapWidth / 2;
    const cy = mapHeight / 2 - worldY;
    const radiusSq = radius * radius;

    // Nur den Bounding-Box-Bereich durchlaufen, nicht die ganze Karte -
    // wichtig fuer die Performance bei mehreren Dutzend Einheiten auf einer
    // 500x500-Karte.
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

  function update(
    units: ReadonlyArray<Pick<EntitySnapshot, 'x' | 'y' | 'unitType' | 'faction'>>,
    reconZones: ReadonlyArray<ReconZone> = [],
    buildings: ReadonlyArray<Pick<BuildingSnapshot, 'x' | 'y' | 'buildingType' | 'faction'>> = [],
  ): void {
    // Erst alles verdunkeln - nur die Alpha-Bytes anfassen, R/G/B bleiben 0.
    for (let i = 3; i < data.length; i += 4) data[i] = DARK_ALPHA_BYTE;

    for (const unit of units) {
      if (unit.faction !== 'player') continue;
      punchCircle(unit.x, unit.y, VISION_RANGE[unit.unitType]);
    }

    // Spieler-Gebaeude sind stationaere Sichtquellen - derselbe Radius, den
    // der Server fuer die Feind-Sichtbarkeit nutzt (visibility.ts).
    for (const building of buildings) {
      if (building.faction !== 'player') continue;
      punchCircle(building.x, building.y, BUILDINGS[building.buildingType].vision);
    }

    // Aufklaerungs-Sweeps (Abschnitt 6): derselbe Bereich, den der Server
    // fuer die Feind-Sichtbarkeit nutzt, wird auch optisch aufgehellt.
    for (const zone of reconZones) {
      punchCircle(zone.x, zone.y, zone.radius);
    }

    texture.needsUpdate = true;
  }

  function dispose(): void {
    // Enabled zuerst auf 0, damit kein Material mehr die gleich entsorgte
    // Textur sichtbar sampelt (Ergebnis wird mit 0 multipliziert).
    fogEnabledUniform.value = 0;
    if (fogMapUniform.value === texture) fogMapUniform.value = null;
    texture.dispose();
  }

  return { update, dispose };
}
