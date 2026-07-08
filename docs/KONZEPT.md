# Bum Bum Taktik — Technisches Konzept & Architektur-Roadmap

Stand: 2026-07-08. Dieses Dokument ist die Grundlage für die Entwicklung. Es wird laufend aktualisiert, wenn sich Entscheidungen ändern.

## 0. Grundannahmen (bereits entschieden)

Diese drei Punkte wurden bewusst festgelegt, weil sie später teuer zu ändern wären:

| Entscheidung | Gewählt | Warum |
|---|---|---|
| Server-Sprache | **Node.js + TypeScript** (nicht Go) | Gleiche Sprache wie der Client → Typen (Spielzustand, Netzwerk-Nachrichten) werden in einem gemeinsamen Paket geteilt statt doppelt gepflegt. Bei nur 6 Spielern bringt Go keinen spürbaren Performance-Vorteil. |
| Weltgröße | **Große, endliche Karte pro Match** (kein unendliches Chunk-Streaming wie Minecraft) | Ein taktisches Gefecht hat Anfang und Ende, keine offene Welt. Deutlich einfacher zu bauen, testen und balancieren. Echtes Streaming bleibt als spätere Ausbaustufe möglich. |
| Netzwerk | **Nur lokales WLAN** | Kein HTTPS/TLS-Zertifikat nötig, `ws://` reicht. Kein Port-Forwarding, keine Angriffsfläche von außen. |

Zusätzliche Annahme (bitte korrigieren, falls falsch): "Koop-Modus" bedeutet **Spieler gemeinsam gegen eine KI-gesteuerte Gegnerfraktion**, nicht Spieler gegen Spieler. Das ist architektonisch relevant: Der Server muss kein strenges Anti-Cheat-Lockstep-Modell fahren, weil kein Mitspieler ein Interesse hat zu betrügen. Das vereinfacht die Client-Server-Aufteilung erheblich (siehe Abschnitt 2).

---

## 1. Technologie-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Server-Runtime | Node.js + TypeScript | Siehe oben. Läuft nativ auf Raspberry Pi OS (ARM64-Build von Node.js). |
| WebSocket-Bibliothek | [`ws`](https://www.npmjs.com/package/ws) | Der Standard im Node-Ökosystem, sehr leichtgewichtig, für 6 gleichzeitige Verbindungen völlig ausreichend — kein Grund für ein schwereres Framework wie Socket.IO. |
| Client-Rendering | [Three.js](https://threejs.org/) mit `OrthographicCamera` | Standardansatz für 2.5D/Isometrie-Spiele (offiziell u. a. für "Age-of-Empires-artige" RTS-Kameras empfohlen). Läuft über WebGL, das Safari auf iPadOS unterstützt. |
| Build-Tool | [Vite](https://vitejs.dev/) | Schneller Dev-Server, TypeScript out-of-the-box, minimal-invasive Konfiguration — gut für Einsteiger. |
| Rauschen für Terrain | [`simplex-noise`](https://www.npmjs.com/package/simplex-noise) (jwagner/simplex-noise) | ~2 KB, keine Abhängigkeiten, läuft in Node und Browser, sehr schnell (~70 Mio. Aufrufe/Sekunde), deterministisch bei gleichem Seed. |
| Monorepo-Verwaltung | npm Workspaces | Kein zusätzliches Tool nötig (im Gegensatz zu pnpm/yarn), Node bringt es seit v7 mit — passt zum Einsteiger-Prinzip "so wenig neue Werkzeuge wie nötig". |
| Grafik-Assets | Kenney.nl + OpenGameArt.org (siehe Abschnitt 7) | Ausschließlich CC0-lizenziert, kommerziell und privat frei nutzbar, keine Namensnennung nötig. |

---

## 2. Architektur: Server-Client-Modell

### 2.1 Grundprinzip: autoritativer Server, interpolierender Client

Der **Server ist die einzige Wahrheit** über den Spielzustand (Position, HP, wer sieht wen). Er läuft eine **Tick-Schleife** (ein "Tick" = ein Simulationsschritt) und schickt regelmäßig Zustands-Schnappschüsse an alle 6 Clients.

- **Tick-Rate: 10–15 Hz** (10–15 Aktualisierungen pro Sekunde). Das ist bewusst niedrig gewählt, weil der Raspberry Pi 4 (Quad-Core Cortex-A72, ~1.5 GHz) kein High-End-Server ist und ein taktisches Spiel keine Zwitch-Shooter-Präzision braucht. Echtzeitstrategiespiele kommen traditionell mit deutlich weniger aus.
- Der **Client rendert mit 60 fps** und **interpoliert** zwischen den letzten zwei empfangenen Server-Schnappschüssen (klassische "Snapshot-Interpolation", Standardtechnik bei Multiplayer-Spielen). Dadurch wirkt die Bewegung flüssig, obwohl der Server nur alle ~70–100 ms ein Update schickt.
- Weil es **Koop gegen KI** ist (kein PvP), kann der Client mehr Berechnung übernehmen als bei einem kompetitiven Spiel üblich wäre — z. B. Pathfinding lokal berechnen und dem Server nur das Ziel melden, statt jeden Zwischenschritt serverseitig zu validieren. Das spart CPU auf dem Pi.

**Wichtige Performance-Falle:** Bei 6 Clients den Zustand **einmal pro Tick serialisieren** (`JSON.stringify` einmal aufrufen) und denselben Buffer an alle 6 Sockets senden — nicht pro Client neu serialisieren. Auf einem Pi 4 kann das Serialisieren bei hoher Entity-Zahl schneller zum Flaschenhals werden als das Netzwerk selbst.

### 2.2 Kartengenerierung: einmalig am Server, dann verteilt

Ursprünglich naheliegend wäre: "Server schickt nur den Zufalls-Seed, jeder Client generiert das Terrain selbst nach." Das spart Bandbreite, hat aber ein reales Risiko: Node.js (V8-Engine) und Safari (JavaScriptCore-Engine) könnten bei Fließkomma-Berechnungen in Randfällen minimal unterschiedliche Ergebnisse liefern — das wäre ein extrem schwer zu findender Bug für einen Einsteiger.

**Empfehlung: Der Server generiert die Karte einmal beim Match-Start und schickt das fertige Ergebnis** (Höhen- und Domain-Raster) als kompaktes Binärpaket an alle Clients. Das passiert nur **einmal pro Match**, nicht pro Tick — bei einer z. B. 512×512-Karte sind das nur wenige hundert KB, im lokalen WLAN unter einer Sekunde. Das ist robuster als geteilte Zufallsberechnung und für den Einstieg die bessere Wahl. (Als spätere Optimierung, falls die Kartengröße stark wächst, kann man auf das Seed-only-Verfahren wechseln — dann aber mit sorgfältigen Cross-Engine-Tests.)

### 2.3 Nachrichtenformat (gemeinsamer Vertrag)

Dieses Interface muss **zuerst** feststehen, bevor parallel gearbeitet wird (siehe Abschnitt 8). Beispiel, in `packages/shared/src/protocol.ts`:

```typescript
export type Domain = 'land' | 'water' | 'air';

// Server → Client, einmalig beim Verbindungsaufbau
export interface ServerHello {
  type: 'hello';
  playerId: string;
  mapWidth: number;
  mapHeight: number;
  terrain: ArrayBuffer; // komprimiertes Höhen-/Domain-Raster
}

// Server → Client, pro Tick
export interface StateUpdate {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  visibleEnemyIds: string[]; // Fog-of-War: nur was das Team gerade sieht
}

export interface EntitySnapshot {
  id: string;
  domain: Domain;
  x: number; y: number; heading: number;
  hp: number;
}

// Client → Server
export type ClientCommand =
  | { type: 'move'; unitIds: string[]; target: [number, number] }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'terminalCmd'; raw: string };
```

---

## 3. Prozedurale Kartengenerierung — Algorithmus

Zweistufiges Noise-Verfahren, wie bei vielen Minecraft-artigen Generatoren, aber ohne Chunk-Streaming — die ganze Karte entsteht einmalig:

1. **Höhen-Noise** (mehrere "Oktaven" von Simplex-Noise übereinandergelegt = "Fractal Brownian Motion"): grobe Oktave für große Landmassen/Inseln, feinere Oktaven für Details. Ergebnis: ein Wert `e` zwischen -1 und 1 pro Kachel.
2. **Feuchtigkeits-Noise** (zweite, unabhängige Noise-Schicht): bestimmt rein optisch/später gameplay-relevant Biome (karg/grün/sumpfig) — klassische Elevation+Moisture-Kombination, wie sie z. B. bei Minecraft-ähnlichen Biom-Systemen verwendet wird.
3. **Schwellenwert-Klassifizierung** aus dem Höhenwert `e`:

| Bereich von `e` | Domain-Typ | Wer kann durch? |
|---|---|---|
| `e < -0.2` | Tiefwasser | Schiffe, U-Boote |
| `-0.2 ≤ e < 0.0` | Flachwasser | Schiffe, U-Boote (aufgetaucht) |
| `0.0 ≤ e < 0.02` | Strand/Küste | Infanterie (Landung), Fahrzeuge |
| `0.02 ≤ e < 0.4` | Ebene | Alle Landeinheiten normal |
| `0.4 ≤ e < 0.7` | Hügel | Panzer langsamer, aber besserer Sichtradius/Radar-Bonus |
| `e ≥ 0.7` | Berge/Gipfel | Nur Infanterie und Luft, für Fahrzeuge unpassierbar |

Luft-Einheiten ignorieren diese Tabelle größtenteils (sie fliegen über allem), können aber optional in Gipfelnähe eingeschränkt werden, wenn du das später spannender machen willst.

Aus diesen Schwellenwerten entstehen **drei separate Begehbarkeits-Raster** (eines pro Domain: Land, Wasser, Luft), auf denen jeweils unabhängig **A\*-Pathfinding** läuft.

**Bewusst nicht in der ersten Version:** hydraulische Erosion, Flusssimulation, Höhlensysteme. Das sind reizvolle spätere Erweiterungen, aber für ein funktionierendes taktisches Schlachtfeld nicht nötig — die Elevation+Moisture-Schwellenwert-Methode reicht für glaubwürdige Inseln/Flüsse/Gebirge.

---

## 4. Rendering-Architektur (Three.js)

- **Orthografische Kamera**, klassischer Isometrie-Winkel (Y-Rotation -45°, X-Neigung ~35°), Blick von schräg oben.
- **Wichtige Einsteiger-Falle:** "Zoomen" bei einer orthografischen Kamera funktioniert **nicht**, indem man die Kamera näher heranfährt (Dolly) — das hat bei orthografischer Projektion keinen sichtbaren Effekt. Zoomen bedeutet hier, den sichtbaren Ausschnitt (`left/right/top/bottom` des Frustums) zu verkleinern/vergrößern.
- **Szenen-Gliederung** in Gruppen: `terrainGroup`, `waterGroup` (einfache animierte Wasserebene, güns­tig für iPad-GPU), `unitsGroup` (Land/Wasser/Luft gemeinsam, Lufteinheiten mit leichtem Y-Versatz + Schattensprite darunter — ein gängiger Isometrie-Trick, der "Fliegen" glaubwürdig verkauft), `fxGroup` (Explosionen, Projektile).
- **Performance auf iPad-GPU:** Einheiten als **Sprite-Instancing** (ein Draw-Call pro Einheiten-*Typ*, nicht pro Einheit) über Textur-Atlanten — bei potenziell 100+ Einheiten (6 Spieler × mehrere Dutzend) entscheidend, um die mobile GPU nicht zu überlasten.
- **Sensor-Overlays als eigene Ebenen, nicht als eigene Szenen:**
  - **Radar:** serverseitig berechnete Kontakte innerhalb des Sensorradius, als HUD-Blips auf einem separaten 2D-Overlay (DOM/Canvas über dem WebGL-Canvas, da Bildschirmraum statt Weltraum).
  - **Wärmebild:** Post-Processing-Shader-Pass, der Texturen durch eine Hitze-Palette ersetzt (heiße Motoren/Einheiten hell, kalte Umgebung dunkel).
  - **Nachtsicht:** grün eingefärbter Post-Processing-Pass mit Sichtradius-Vignette.
  - **Sonar:** wie Radar, aber nur in der Wasser-Domain, mit expandierenden "Ping"-Ringen und leichter Verzögerung bis Kontakte erscheinen (taktischer Kniff: aktives Pingen macht das eigene U-Boot ebenfalls sichtbar).
  - **Jamming/elektronische Kampfführung:** serverseitige Zone, die den effektiven Sensorradius betroffener Spieler reduziert; clientseitig als durchscheinende Kuppel dargestellt.

---

## 5. Hybrid-Steuerung (Touch + Tastatur + Terminal)

Ein zentraler `InputManager` verwaltet drei gleichzeitige Eingabequellen, ohne dass sie sich gegenseitig Ereignisse "klauen":

### 5.1 Touch (Kamera schwenken/zoomen)
- Native **Touch-Events** (`touchstart`/`touchmove`/`touchend`) reichen für Schwenken (1 Finger) + Pinch-Zoom (2 Finger) völlig aus — eine zusätzliche Bibliothek wie Hammer.js ist nicht nötig und würde nur unnötige Komplexität für ein Einsteiger-Team bedeuten.
- **Zwingend:** `event.preventDefault()` in den Touch-Handlern und CSS `touch-action: none` auf dem Canvas setzen. Sonst interpretiert Safari die Gesten zusätzlich als Pinch-to-Zoom der ganzen Seite, Pull-to-Refresh oder Edge-Swipe-Navigation — das zerschießt sonst jede Kamerasteuerung.
- Aktive Finger werden in einer `Map<pointerId, {x,y}>` verfolgt, um bei 2 Fingern die Distanzänderung (= Zoom) selbst zu berechnen.

### 5.2 Tastatur (Hotkeys)
- **Nur unmodifizierte Tasten** (Buchstaben, Ziffern, Funktionstasten) verwenden — **keine** Cmd/Ctrl-Kombinationen. Safari auf iPadOS fängt viele Cmd-Kombinationen auf Browser-/OS-Ebene ab (Tab wechseln, schließen etc.), bevor sie überhaupt bei der Webseite ankommen.
- Externe Bluetooth-/Smart-Keyboards lösen auf iPadOS zuverlässig normale `keydown`/`keyup`-Events mit korrektem `event.key`/`event.code` aus — kein Sonderfall nötig, funktioniert wie am Desktop.
- Hotkey-Tabelle als einfache Zuordnung, z. B. `{ '1': selectGroup(1), 'q': openBuildMenu, ... }`.
- **Wichtig:** Wenn das Terminal (siehe unten) den Fokus hat, dürfen Tastatur-Events **nicht** zusätzlich als Spiel-Hotkeys interpretiert werden — ein einfaches Fokus-Flag oder Prüfung auf `document.activeElement` reicht.

### 5.3 Zusammenspiel Hotkey + Tap-to-Target
Typischer Ablauf: Spieler drückt Hotkey `1` (wählt Einheitengruppe 1) → tippt danach auf den Bildschirm → das Tap wird per Raycast (Kamera + Bildschirmkoordinaten) in Weltkoordinaten der Three.js-Szene umgerechnet → `move`-Befehl mit diesem Ziel an den Server.

---

## 6. In-Game-Terminal (CLI)

**Empfehlung: ein eigenes, schlankes Terminal-Widget bauen, nicht xterm.js einbinden.** xterm.js ist für einen "echten" Terminal-Emulator (mit ANSI-Farben, PTY-Anbindung) gedacht — hier reicht ein einfaches Scrollback-`<div>` + ein `<input>`-Feld, das per Hotkey (z. B. die Taste `` ` ``, unmodifiziert, kollidiert mit nichts) ein-/ausgeblendet wird. Das ist für ein Einsteiger-Team leichter zu warten und zu erweitern.

**Befehls-Registry**, damit neue Befehle unabhängig voneinander (auch von verschiedenen Subagenten) hinzugefügt werden können, ohne dieselbe Datei zu bearbeiten:

```typescript
type CommandHandler = (args: string[], ctx: TerminalContext) => string | Promise<string>;
const registry = new Map<string, CommandHandler>();
export function registerCommand(name: string, handler: CommandHandler) {
  registry.set(name, handler);
}
```

Beispielbefehle: `drone list`, `drone move <id> <x> <y>`, `hack <zielId>` (löst Hacking-Minispiel/Skill-Check aus), `recon <x> <y> <radius>` (Aufklärungs-Sweep, deckt Fog-of-War-Bereich auf, ggf. mit Cooldown).

---

## 7. Asset-Pipeline

**Bestätigte, freie Quellen (CC0, keine Namensnennung nötig):**

| Quelle | Paket | Inhalt |
|---|---|---|
| Kenney.nl | [Tanks](https://kenney.nl/assets/tanks) | 80 Sprites, Top-Down-Panzer |
| Kenney.nl | [Top-Down Tanks](https://kenney.nl/assets/top-down-tanks) | 85 Sprites |
| Kenney.nl | [Pixel Vehicle Pack](https://www.kenney.nl/assets/pixel-vehicle-pack) | 50 Fahrzeug-Sprites |
| OpenGameArt.org | ["PixVoxel" Isometric Wargame Sprites](https://opengameart.org/content/pixvoxel-colorful-isometric-wargame-sprites) (Tommy Ettinger) | Tausende Sprites, 8-Richtungs-Animation, mehrere Paletten, Panzer/Infanterie mit Upgrade-Varianten (Power/Speed/Technique) |

**Noch zu prüfen, nicht raten:** Für Schiffe/U-Boote/Flugzeuge wurde in der Recherche kein dediziertes Kenney-Marine-/Luftfahrt-Pixel-Paket bestätigt. Bevor du dich auf ein bestimmtes Paket festlegst, direkt auf kenney.nl/assets bzw. opengameart.org nachschauen, statt einen Paketnamen anzunehmen, der vielleicht nicht existiert.

**Performantes Laden:** Sprites eines Einheitentyps in **einem Textur-Atlas** (Spritesheet) bündeln, nicht als einzelne PNG-Dateien — Kenneys Pakete liefern das meist schon so aus. Beim Start werden alle Atlanten einmal vorab geladen (mit einem Ladebalken), damit während des Matches keine Ladeaussetzer entstehen.

---

## 8. Ordnerstruktur (Monorepo, npm Workspaces)

```
bum-bum-taktik/
├── package.json                  # "workspaces": ["packages/*"]
├── tsconfig.base.json
├── .github/workflows/ci.yml      # Lint + Typecheck + Build bei jedem Push
├── packages/
│   ├── shared/                   # ZUERST fertigstellen, nicht parallelisieren!
│   │   └── src/
│   │       ├── protocol.ts       # WebSocket-Nachrichtenformate (Abschnitt 2.3)
│   │       ├── constants.ts      # Tick-Rate, Domain-Enums, Kartengrößen
│   │       ├── procgen/terrain.ts
│   │       └── types.ts
│   ├── server/                   # Subagent A
│   │   └── src/
│   │       ├── index.ts          # WebSocket-Server, Port 8081
│   │       ├── gameLoop.ts
│   │       ├── world.ts
│   │       ├── combat.ts
│   │       ├── ai/
│   │       └── hacking.ts
│   └── client/
│       └── src/
│           ├── main.ts
│           ├── render/           # Subagent B
│           │   ├── scene.ts
│           │   ├── camera.ts
│           │   ├── units.ts
│           │   └── overlays/     # Radar, Wärmebild, Nachtsicht, Sonar
│           ├── input/            # Subagent C
│           │   ├── touch.ts
│           │   ├── hotkeys.ts
│           │   └── inputManager.ts
│           ├── terminal/         # Subagent D
│           │   ├── Terminal.ts
│           │   └── commands/
│           ├── net/               # dünner WebSocket-Client
│           └── ui/                 # HUD, Menüs
├── assets/
│   ├── sprites/{land,water,air,infantry,fx}/
│   └── ATTRIBUTION.md            # Lizenznachweise (auch bei CC0 gute Praxis)
└── docs/
    └── KONZEPT.md                # dieses Dokument
```

### 8.1 Aufteilung für parallele Subagenten

**Wichtig: Erst das Fundament, dann parallelisieren.** Bevor Subagenten gleichzeitig arbeiten, muss ein sogenannter "Walking Skeleton" stehen — eine minimale Ende-zu-Ende-Kette: eine Einheit auf einer Platzhalter-Karte, die sich bewegt, per WebSocket synchronisiert wird und in der orthografischen Kamera sichtbar ist. Ohne diesen gemeinsamen Vertrag (v. a. `shared/protocol.ts`) raten alle Subagenten nur, wie die Schnittstellen aussehen, und die Ergebnisse passen später nicht zusammen.

Danach parallele Aufteilung:

| Subagent | Verantwortungsbereich | Dateien |
|---|---|---|
| A – Server/Netcode | Tick-Schleife, autoritativer Zustand, Kampfauflösung, Gegner-KI | `packages/server/*` |
| B – Rendering | Three.js-Szene, Kamera, Sprite-Rendering, Sensor-Overlays | `packages/client/src/render/*` |
| C – Eingabe | Touch-Gesten, Hotkeys, Tap-to-Target | `packages/client/src/input/*` |
| D – Terminal & Hacking | CLI-Widget, Befehls-Parser, Hacking-Minispiel | `packages/client/src/terminal/*` + `server/src/hacking.ts` |
| E – Prozedurale Generierung | Noise-Algorithmus, Domain-Schwellenwerte, Balancing | `packages/shared/src/procgen/*` |
| F – Asset-Pipeline | Sprites organisieren, Textur-Atlanten, Ladelogik | `assets/*` + `client/src/render/loader.ts` |

Diese Aufteilung folgt bewusst den Ordnergrenzen, damit zwei Subagenten möglichst selten dieselbe Datei anfassen — das minimiert Merge-Konflikte.

### 8.2 Branching-Strategie

- `main` ist geschützt und immer lauffähig.
- Das Fundament (Abschnitt 8.1) entsteht direkt mit dir zusammen, kein eigener Branch nötig — zu klein und zu grundlegend, um es zu parallelisieren.
- Danach: ein kurzlebiger Branch pro Subagenten-Bereich, z. B. `agent/server-tickloop`, `agent/render-orthographic-scene`, `agent/input-touch-hotkeys`, `agent/terminal-commands`, `agent/procgen-balancing`, `agent/assets-atlas`.
- Jeder Branch → Pull Request gegen `main` → du prüfst (ggf. mit Unterstützung) → Merge.
- Branches kurz halten und regelmäßig gegen `main` aktualisieren, damit Konflikte klein bleiben.

---

## 9. Architektur-Roadmap (Phasen)

**Phase 0 — Fundament** (sequenziell, nicht parallelisieren)
- Repo-Setup, npm Workspaces, TypeScript-Konfiguration, CI-Pipeline (Lint/Typecheck/Build)
- `shared/protocol.ts` + `shared/types.ts` festlegen
- Walking Skeleton: 1 Einheit, Platzhalter-Karte, WebSocket-Sync, orthografische Kamera — getestet auf echtem Raspberry Pi 4 mit einem echten iPad

**Phase 1 — Kernsysteme** (parallelisierbar)
- Terrain-Generierung (Land/Wasser-Domain zuerst, Luft später), Begehbarkeits-Raster
- Grundbewegung + Pathfinding pro Domain
- Hybrid-Eingabe: Schwenken/Zoomen, Hotkey-Tabelle, Tap-to-Target
- Sprite-Rendering mit den CC0-Assets, Textur-Atlas

**Phase 2 — Gefecht & Mehrspieler-Sync**
- Kampfauflösung, Projektile, Treffer-Berechnung
- Tick-Rate/Interpolation auf echter Hardware (6 iPads gleichzeitig) feinjustieren
- Fog of War, Basis-Radar

**Phase 3 — Erweiterte Features**
- Sonar (U-Boote), elektronische Kampfführung/Jamming
- Luft-Domain (Flugzeuge/Drohnen), Luftschläge
- In-Game-Terminal + Hacking-Minispiel
- Wärmebild-/Nachtsicht-Overlays

**Phase 4 — Politur & Lasttest**
- Echter Lasttest: Raspberry Pi 4 + 6 physische iPads gleichzeitig im selben WLAN
- Asset-Optimierung (Atlas-Größe, Ladezeiten)
- Als installierbare PWA einrichten (`manifest.json` mit `display: standalone`) — blendet Safaris Adressleiste/Gesten aus, fühlt sich wie eine echte App an
- Feinschliff Touch-Ergonomie

---

## 10. Risiken & Stolperfallen (konkret, nicht generisch)

1. **Orthografische Kamera "zoomt" nicht durch Heranfahren** — siehe Abschnitt 4. Ein klassischer Anfängerfehler, der sonst viel Debugging-Zeit kostet.
2. **WebGL-Kontextverlust auf iOS Safari:** Safari kann den WebGL-Kontext eines Tabs bei Speicherdruck oder im Hintergrund killen — besonders relevant, wenn 6 iPads gleichzeitig WebGL-lastige Inhalte laufen lassen. Unbedingt auf `webglcontextlost`/`webglcontextrestored` reagieren und dem Spieler einen Reconnect-Hinweis zeigen, statt dass die Seite einfach schwarz bleibt.
3. **RPi4-CPU-Budget:** Bei höherer Tick-Rate wird das Serialisieren des Zustands (nicht das Netzwerk!) zum Flaschenhals — siehe Hinweis in Abschnitt 2.1 (einmal serialisieren, an alle 6 senden).
4. **Speicher-Eviction von Hintergrund-Tabs:** Wenn das Spiel als normaler Safari-Tab (nicht als Home-Screen-App) läuft, kann iPadOS es beim App-Wechsel aus dem Speicher werfen. Die PWA-Installation (Abschnitt 9, Phase 4) mindert das deutlich.
5. **Cross-Engine-Determinismus bei Noise:** siehe Abschnitt 2.2 — deshalb die Empfehlung, die Karte serverseitig einmalig zu generieren statt clientseitig nachzurechnen.
6. **Heim-WLAN-Kapazität:** 6 iPads + Raspberry Pi im selben Haushalt — bei 2,4-GHz-WLAN kann es zu Engpässen kommen. Kein Code-Problem, aber praktisch relevant: Router auf 5 GHz stellen bzw. Pi per LAN-Kabel anschließen, wenn möglich.

---

## Offene Punkte für später

- Genaue Kartengröße (z. B. 512×512 vs. 1024×1024 Kacheln) sollte nach ersten Performance-Tests auf echter Hardware festgelegt werden.
- Ob Spielstände zwischen Sitzungen gespeichert werden müssen (aktuell angenommen: nein, jedes Match startet frisch) — falls doch, braucht es eine einfache Persistenzschicht (z. B. SQLite auf dem Pi).
- Konkrete Marine-/Luftfahrt-Asset-Quelle noch zu recherchieren (Abschnitt 7).
