# Bum Bum Taktik — Technisches Konzept & Architektur-Roadmap

Stand: 2026-07-17. Dieses Dokument ist die Grundlage für die Entwicklung. Es wird laufend aktualisiert, wenn sich Entscheidungen ändern.

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

### 3.1 Map-Presets ("Regionen") — entschieden & umgesetzt (2026-07-11)

Statt einer einzigen Karte gibt es benannte Parametersätze für `generateTerrain` in `shared/src/procgen/presets.ts` (`MAP_PRESETS`). Ein Preset legt Kartengröße, Seed und Generator-Optionen fest; die Zahlenwerte sind per ASCII-Vorschau getunt (`npm run preview -w @bum-bum-taktik/shared -- <preset>`).

| Preset | Größe | Idee | Technik |
|---|---|---|---|
| `wueste` | 500×500 | Sand dominiert, vereinzelte Oasen und Felsen | Wassergrenzen ganz tief (nur tiefste Täler werden Oasen); Ebenen mit Feuchtigkeit unter `sandMoistureMax` werden zu **Sand** |
| `gebirge` | 500×500 | Ausgeprägte Gebirgszüge, Schnee auf den Gipfeln | **Ridged-Noise** (gespiegelter Betrag → scharfe Kämme); Kacheln ab `snowMin` werden zu **Schnee** |
| `plains` | 500×500 | Die bisherige Standardkarte | Nur Default-Parameter, Seed 1 — Look unverändert |
| `meer` | 500×500 | Offenes Meer; zwei größere Inseln mit Brücke, kompakt in der Kartenmitte | Landgrenze hoch + grobes Noise; `islandRegion`: Land entsteht nur im zentralen **100×100-Quadrat**, außerhalb sinkt der Meeresboden sanft auf Tiefwasser ab; **Post-Processing** (`bridge.ts`): Flood-Fill findet die zwei größten Inseln, nächstgelegenes Küstenpaar wird mit einer geraden, 2 Kacheln breiten Brücke verbunden |

Dafür wurden drei Terrain-Typen ergänzt (nur hinten an `TERRAIN_TYPES` angehängt, damit sich bestehende Indizes nicht verschieben): `sand` (begehbar wie Ebene), `snow` (wie Berge), `bridge`. Die Brücke ist bewusst in **beiden** Begehbarkeits-Rastern frei — Landeinheiten fahren drüber, Schiffe drunter durch; möglich, weil die Raster pro Domain getrennt sind (Abschnitt 3).

### 3.2 Missionen — Minimaldefinition (2026-07-11), startbar seit 2026-07-11

Eine **Mission** gehört zu genau einer Region (= Map-Preset) und ist vorerst nur: `id`, `name`, `description` und eine **Startaufstellung** (Liste aus Einheitentyp + Fraktion + Anzahl). Definiert als Daten in `shared/src/missions.ts` (`MISSIONS`, `missionsForRegion`, `getMission`). Die Spawn-*Positionen* bleiben Server-Logik (Ring-Suche um die Kartenmitte). Bewusst noch **nicht** definiert: Siegbedingungen, Skript-Ereignisse, Belohnungen — das kommt, sobald die erste Mission wirklich spielbar ist. *(Update 2026-07-17: Siegbedingungen und Belohnungen sind jetzt festgelegt — siehe Kasten „Gameplay-Loop, Wirtschaft & Meta“ in Abschnitt 9.)* Ausgewählt werden Region und Mission über das In-Game-Terminal (Abschnitt 6).

**Umgesetzt:** `mission start <id>` im Terminal schickt den typisierten `startMission`-Befehl; der Server wechselt auf die Region der Mission (immer frische Generierung = Neustart), spawnt die Startaufstellung und schickt allen Clients ein neues `hello` mit `missionId`. `map select` verlässt eine laufende Mission (freie Aufstellung). Spawn-Regeln: Spieler nahe der Kartenmitte, Feinde im Ring (Mindestradius 20) **plus echtem Mindestabstand zu den tatsächlich platzierten Spieler-Einheiten** — die reine Ring-Logik reichte nicht, weil z. B. beim Meer-Preset die Kartenmitte im Wasser liegt und Spieler-Spawns weit vom Zentrum abgedrängt werden können.

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

**Offen für später — Truppenauswahl über das Terminal statt über Bildschirm-Buttons:** Bewusst *keine* zusätzlichen Side-Buttons für die Truppenauswahl einplanen. Auf einem iPad ist Bildschirmfläche knapp, und ein weiteres UI-Element würde mit der Sensor-Overlay-Fläche (Abschnitt 4) konkurrieren. Stattdessen passt Truppenauswahl besser als Befehl in das ohnehin geplante In-Game-Terminal (Abschnitt 6), z. B. `select tank-1` oder `select all land` — konsistent mit den dortigen Befehlen (`drone list`, `drone move`, …) und ohne zusätzliche Touch-Fläche. Klick-zum-Selektieren direkt auf die Einheit (aktuell in `client/src/main.ts` implementiert) bleibt der primäre Weg; die Terminal-Variante wäre eine Ergänzung für präzise/mehrfache Auswahl.

---

## 6. In-Game-Terminal (CLI)

**Empfehlung: ein eigenes, schlankes Terminal-Widget bauen, nicht xterm.js einbinden.** xterm.js ist für einen "echten" Terminal-Emulator (mit ANSI-Farben, PTY-Anbindung) gedacht — hier reicht ein einfaches Scrollback-`<div>` + ein `<input>`-Feld. Das ist für ein Einsteiger-Team leichter zu warten und zu erweitern.

**Fensterform (festgelegt 2026-07-11):** das Terminal ist ein schwebendes Fenster im macOS/Windows-Stil — Titelleiste zum Verschieben, roter Punkt zum Schließen, Größe änderbar über die Ecke unten rechts. Geöffnet/geschlossen wird es über einen festen Seiten-Button am linken Bildschirmrand mit Terminal-Logo (`>_`). Hintergrund: der ursprüngliche Hotkey-Toggle (Taste neben der 1) scheiterte auf deutschen Mac-Tastaturen an einem Chromium-Problem (`Backquote`/`IntlBackslash` auf ISO-Layouts vertauscht); als Bonus reagieren jetzt beide Codes weiterhin, Escape schließt.

**Optik (festgelegt 2026-07-11):** bewusst oldschool — 90er-Retro-Terminal: schwarzer (leicht transparenter) Hintergrund, grüner Monospace-Text, Block-Cursor. Beim Spielstart ist das Terminal geöffnet und fordert zur Regionswahl auf (Abschnitt 3.1/3.2).

**Befehls-Registry**, damit neue Befehle unabhängig voneinander (auch von verschiedenen Subagenten) hinzugefügt werden können, ohne dieselbe Datei zu bearbeiten:

```typescript
type CommandHandler = (args: string[], ctx: TerminalContext) => string | Promise<string>;
const registry = new Map<string, CommandHandler>();
export function registerCommand(name: string, handler: CommandHandler) {
  registry.set(name, handler);
}
```

Beispielbefehle: `drone list`, `drone move <id> <x> <y>`, `hack <zielId>` (löst Hacking-Minispiel/Skill-Check aus), `recon <x> <y> <radius>` (Aufklärungs-Sweep, deckt Fog-of-War-Bereich auf, ggf. mit Cooldown), `select <id...>` / `select all <domain>` (Truppenauswahl über das Terminal statt über zusätzliche Bildschirm-Buttons — siehe Abschnitt 5.3).

---

## 7. Asset-Pipeline

**Bestätigte, freie Quellen (CC0, keine Namensnennung nötig):**

| Quelle | Paket | Inhalt |
|---|---|---|
| Kenney.nl | [Tanks](https://kenney.nl/assets/tanks) | 80 Sprites, Top-Down-Panzer |
| Kenney.nl | [Top-Down Tanks](https://kenney.nl/assets/top-down-tanks) | 85 Sprites |
| Kenney.nl | [Pixel Vehicle Pack](https://www.kenney.nl/assets/pixel-vehicle-pack) | 50 Fahrzeug-Sprites |
| OpenGameArt.org | ["PixVoxel" Isometric Wargame Sprites](https://opengameart.org/content/pixvoxel-colorful-isometric-wargame-sprites) (Tommy Ettinger) | Tausende Sprites, 8-Richtungs-Animation, mehrere Paletten, Panzer/Infanterie mit Upgrade-Varianten (Power/Speed/Technique) |

**Marine-/Luft-Assets — recherchiert & entschieden (2026-07-11):** Das PixVoxel-Pack enthält laut seiner OpenGameArt-Seite selbst Marine-Einheiten (**Patrol Boat, Battleship, Cruiser, Submarine**) und ein Flugzeug (**Plane_P**) — im selben orthogonalen Stil/Palettenschema wie die schon genutzten Infanterie-Sprites. **Empfehlung: dabei bleiben, kein neues Paket.** Geprüfte Alternativen, alle schlechter: Kenney hat kein modernes Marine-/Luft-Top-Down-Paket (nur das thematisch unpassende Pirate Pack); das zweite PixVoxel-Pack ("Very Diverse") ist laut Autor **nicht kompatibel** mit den orthogonalen Sprites (nur isometrisch, anderer Winkel); die CC0-Flugzeug-Packs von sujit1717 ("Top Down Planes", "Dark War Pack") wären nur Notlösungen mit Stilbruch. Noch offen: ob das Submarine-Sprite einen getauchten Zustand hat — beim Extrahieren im Archiv nach `Submarine_*` schauen.

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
- Kampfauflösung, Projektile, Treffer-Berechnung ✅ *(siehe Kasten unten)*
- Tick-Rate/Interpolation auf echter Hardware (6 iPads gleichzeitig) feinjustieren
- Fog of War, Basis-Radar ✅ *(siehe Kasten unten)*

> **Fog of War, Radar & Gegner-KI — entschieden & umgesetzt (2026-07-11):**
> - **Serverseitige Sichtbarkeit** (`server/src/visibility.ts`): pro Tick werden nur die Feind-Einheiten mitgeschickt, die mindestens eine Spieler-Einheit sieht (Sichtweite pro Einheitentyp in `shared/constants.ts` → `VISION_RANGE`; Panzer 10, Infanterie 8, Boot 12, Flugzeug 16). Zusätzlich sichtbar: Feinde, die im selben Tick geschossen haben (Mündungsfeuer verrät die Position — sonst gäbe es Tracer aus dem Nichts). Koop = geteilte Sicht: ein gefiltertes Paket für alle Clients, weiterhin einmal serialisiert (Abschnitt 2.1).
> - **Client-Verdunkelung** (`client/src/render/fog.ts`): Ebene über der Karte mit einer DataTexture (1 Texel pro Kachel), Sichtkreise der eigenen Einheiten werden pro Server-Tick freigestempelt; zwei Zustände, bewusst kein "erkundet"-Gedächtnis.
> - **Basis-Radar** (`client/src/ui/minimap.ts`): Minimap unten rechts als 2D-Canvas im Bildschirmraum (wie in Abschnitt 4 vorgesehen) — Terrain einmal pro Kartenwechsel gedownsampelt, Blips pro Tick (grün eigene, rot sichtbare Feinde). Kamera-Rechteck und Klick-zum-Schwenken: später.
> - **Gegner-KI, Minimalversion** (`server/src/ai.ts`): Feind-Einheiten ohne Ziel nehmen die nächste Spieler-Einheit innerhalb `ENEMY_AGGRO_RANGE` (14) ins Visier; Verfolgung/Feuer über die vorhandene Angriffslogik, einmal aggro = bis zum Tod. Aggro-Reichweite liegt bewusst über der Sichtweite der Bodeneinheiten: nur der Aufklärer (Flugzeug) sieht Feinde, bevor sie angreifen. Patrouillen/Gruppenverhalten: spätere Ausbaustufe.
> - **Auto-Reconnect** (`client/src/net/client.ts`): Client verbindet nach Trennung (Server-Neustart, iPad-Ruhezustand) automatisch neu mit Backoff 1–5 s; korrekt, weil jedes `hello` ein kompletter Welt-Neuaufbau ist. WebGL-Kontextverlust (Risiko 2) lädt die Seite neu.

> **Kampfauflösung — entschieden & umgesetzt (2026-07-10):**
> - **Ziel-Logik:** Auto-Feuer auf den nächsten Feind in Reichweite (beide Fraktionen), zusätzlich expliziter Angriffsbefehl per Klick auf einen Feind — die Einheit verfolgt das Ziel und feuert ab Reichweite. Bewegungsbefehl bricht den Angriff ab.
> - **Treffer-Modell:** Sofort-Treffer ("Hitscan") im Server-Tick statt echter Projektile mit Flugzeit; der Client zeichnet pro Schuss nur eine kurze Tracer-Linie (`ShotEvent` im `StateUpdate`). Echte Projektile bleiben als spätere Ausbaustufe möglich, ohne das Protokoll umzubauen.
> - **Gleichzeitige Auflösung:** Alle Schüsse eines Ticks werden erst gesammelt, dann Schaden abgezogen — niemand stirbt, bevor er im selben Tick noch zurückschießen konnte.
> - **Werte:** HP/Reichweite/Schaden/Feuerpause pro Einheitentyp zentral in `shared/constants.ts` (`COMBAT_STATS`).
> - **Fraktionen:** `player` vs. `enemy` (Koop, Abschnitt 0). Server ignoriert Befehle an Feind-Einheiten und Friendly Fire.

**Phase 3 — Erweiterte Features**
- Sonar (U-Boote), elektronische Kampfführung/Jamming
- Luft-Domain (Flugzeuge/Drohnen), Luftschläge
- In-Game-Terminal ✅ + Hacking-Minispiel ✅ *(siehe Kasten unten)*
- Wärmebild-/Nachtsicht-Overlays

> **Hacking-Minispiel — entschieden & umgesetzt (2026-07-12):** Umsetzung: `server/src/hacking.ts` (Challenges, Fristen, Stun, Alarm), Stun-Verhalten in `server/src/gameLoop.ts` (`stunnedMs`), Terminal-Befehl `client/src/terminal/commands/hack.ts` mit Line-Interceptor in `terminal/registry.ts`, türkiser Stun-Balken in `client/src/render/units.ts`. Serverseitig mit 9 Headless-WebSocket-Tests verifiziert (alle Ablehnungsgründe, Erfolg+Stun+Ablauf, Timeout).
> - **Ablauf:** `hack <zielId>` im Terminal → Server validiert (Ziel ist sichtbarer Feind, mindestens eine eigene Einheit in `HACK_RANGE` = 12 Kacheln) → Server schickt **nur dem Anforderer** eine `hackChallenge`: einen Zugriffscode aus 4 Hex-Bytes (z. B. `A3 F0 7C 21`) mit 12 s Zeitlimit → Spieler tippt den Code im Terminal nach (Vergleich case-insensitiv, Leerzeichen egal) → `hackResult`.
> - **Erfolg:** Ziel ist 8 s **lahmgelegt** (bewegt sich nicht, schießt nicht) — steht als `stunned` im Snapshot, damit alle Clients es anzeigen können. **Fehlschlag/Timeout:** das Ziel ist alarmiert und nimmt sofort die nächste Spieler-Einheit ins Visier (Risiko statt Bestrafungs-Cooldown).
> - **Warum Code-Nachtippen statt Rätsel/Mastermind:** in V1 zählt der Spannungsbogen (Zeitdruck), nicht die Denksportaufgabe — trivial zu generieren und serverseitig zu prüfen, für Anfänger sofort verständlich, und die Schwierigkeit hängt an zwei Konstanten (`HACK_CODE_BYTES`, `HACK_TIME_LIMIT_MS`) statt an einem Puzzle-Generator. Anspruchsvollere Challenges können die `hackChallenge`-Nachricht später erweitern, ohne das Protokoll umzubauen.
> - **Balance-Dreieck:** `HACK_RANGE` (12) > Waffen-Reichweite (max. 8), aber < `ENEMY_AGGRO_RANGE` (14) — man kann außerhalb des Feuerbereichs hacken, riskiert aber Aggro.
> - **Regeln:** pro Ziel und pro Anforderer max. ein laufender Hack (`alreadyHacking`); Abbruch durch Eingabe von `abbruch` (schickt `hackAbort`). Der Server prüft Timeouts im Tick und meldet sie aktiv.
> - **Terminal-Mechanik:** während eines laufenden Hacks fängt ein **Line-Interceptor** in der Befehls-Registry die nächste Eingabezeile ab (sie geht an den Hack statt an die Befehlssuche) — der schon in Abschnitt 6 angelegte Erweiterungspunkt.

> **Recon-Sweep & Missionsende — entschieden & umgesetzt (2026-07-12):**
> - **`recon <x> <y> [radius]`** (Abschnitt 6): deckt den Bereich 10 s lang auf — Feinde darin werden gesendet (`server/src/recon.ts` + Erweiterung von `visibility.ts`), der Client hellt denselben Bereich im FoW-Overlay auf (`reconZones` im `StateUpdate`). Danach 60 s **Team-Cooldown** (Koop = geteilte Fähigkeit, sonst hielten sechs iPads die Karte dauerhaft offen). Radius default 15, max 25 (geklemmt statt abgelehnt). Kartenwechsel räumt Sweeps ab, lässt den Cooldown aber bewusst laufen (kein Reset-Trick über Missionsneustart).
> - **Missionsende** (Abschnitt 3.2): der Server prüft pro Tick bei aktiver Mission, ob alle Feinde (**won**) oder alle Spieler-Einheiten (**lost**) zerstört sind, und broadcastet einmalig `missionEnd`; das Terminal meldet das Ergebnis. Die Welt läuft danach weiter — Aufräumen übernimmt der nächste `mission start`/`map select`. Beide Seiten gleichzeitig tot zählt als Sieg (die Mission war, die Feinde loszuwerden).

> **Gebäude & Basen — entschieden & umgesetzt (2026-07-17):** Umsetzung: `server/src/buildings.ts` (Platzierung, Einnahme, Produktion, Turm-Feuer), Angriffsziel-Erweiterung in `server/src/gameLoop.ts`, Sichtquellen in `visibility.ts`/`client/src/render/fog.ts`, prozedurale Modelle in `client/src/render/buildings.ts`, Terminal-Befehl `buildings`. Serverseitig mit 13 Headless-WebSocket-Tests verifiziert.
> - **Aufstellung pro Karte** (bei jedem `map select`/`mission start` neu platziert, Ring-Suche auf Landkacheln mit Lockerungs-Fallback für Insel-Karten): Spieler-HQ + Fabrik nahe der Kartenmitte, Feind-HQ + Fabrik + 2 Wachtürme ≥ 25 Kacheln entfernt, 3 neutrale Städte im Ring dazwischen verteilt.
> - **Vier Rollen** (Werte zentral in `shared/constants.ts` → `BUILDINGS`): **zerstörbar** (HQ 500 HP, Fabrik 300, Stadt 250, Turm 200 — explizites Angriffsziel per Klick, `attackTargetId` akzeptiert auch Gebäude-IDs; Gebäude zählen als Land-Ziel, Auto-Feuer bleibt auf Einheiten beschränkt); **einnehmbar** (nur Fabrik + Stadt: Infanterie einer fremden Fraktion in `CAPTURE_RANGE` = 3 füllt 8 s Fortschritt, Abwesenheit lässt ihn zerfallen, beide Fraktionen gleichzeitig = umkämpft = Pause); **Sichtquelle** (Spieler-Gebäude stanzen FoW-Kreise und melden Feinde, Vision HQ 12 / Turm 10 / Fabrik 8 / Stadt 6); **Produktion** (Fabriken spawnen alle 30 s eine Infanterie ihrer Fraktion, Cap 5 pro Fabrik und Karte — verhindert Karten-Flutung).
> - **Wachturm** ist das einzige Gebäude mit Waffe (`TOWER_WEAPON`: Flak, Reichweite 7, Schaden 12, 1,2 s Feuerpause, trifft alle Domains — im Test schießt er ein anfliegendes Flugzeug in ~8 s ab). Turm-Schaden fällt sofort statt in der "gleichzeitig feuern"-Auflösung: Gebäude können nicht zurückerschossen werden, bevor sie sterben.
> - **Protokoll:** `StateUpdate.buildings` enthält bewusst IMMER alle Gebäude (auch im FoW) — statische Landmarken, die man kennt, kein beweglicher Feind; spart die Sichtbarkeitsfilterung. Einnahme läuft als `captureProgress`/`captureBy` im Snapshot mit (gelber Fortschrittsbalken im Client).
> - **Sieg/Niederlage** hängt weiterhin nur an Einheiten, nicht an Gebäuden — ein HQ-Verlust beendet keine Mission (spätere Ausbaustufe, z. B. "HQ zerstören"-Missionsziel).

> **Gameplay-Loop, Wirtschaft & Meta — entschieden (2026-07-17), Umsetzung in drei Sessions:** Bestandsaufnahme mit Lucas: Das Spiel hat viele Systeme, aber keinen Gameplay-Loop — man landet in einer Mission ohne Ziel und Vorgaben. Dazu UX-Baustellen (Minimap ohne Klick-Navigation, FoW-Ebene deckt bei geneigter Kamera nicht, Einheiten so groß wie Gebäude, Terminal zeigt nicht, was mit welcher Einheit los ist). Festgelegt:
> - **Kampagne zuerst** (Eroberungs-/Skirmish-Modus bleibt spätere Ausbaustufe): jede Mission bekommt ein klares Ziel (`objective`, z. B. `destroyHQ`, `captureCities(n)`, `eliminateAll`) und einen Briefing-Text; der Server prüft Sieg/Niederlage anhand des Ziels — Niederlage auch, wenn das eigene HQ fällt. 2–3 Missionen pro Region als Kette mit ansteigender Schwierigkeit, Folge-Mission wird erst nach Sieg freigeschaltet (Freischaltung vorerst nur im Server-Speicher; Persistenz kommt in Session C). Terminal: Briefing beim Start, `objective`-Befehl zeigt Zielstatus/Fortschritt.
> - **Wirtschaft mit zwei Ressourcen** (bewusst gegen die einfachere Ein-Währungs-Variante entschieden, mehr Balancing-Aufwand in Kauf genommen): **Credits** aus eingenommenen Städten, **Material** aus Minen. Einheiten kosten Ressourcen und entstehen am passenden Gebäude: Kaserne→Infanterie, Fabrik→Panzer, Hafen→Boote, Flugplatz→Flugzeuge. Dafür neue neutrale, einnehmbare POIs (Mine, Kaserne, Hafen, Flugplatz) — füllt zugleich die zu leere Karte; dazu Deko wie Wälder/Felsen als Instanced Meshes (iPad-GPU-Budget beachten).
> - **Einheiten-Info, zweistufig:** sofort ein **Terminal-Event-Log** (Server meldet: Einheit unter Beschuss, Einheit/Gebäude verloren, Einnahme abgeschlossen, Produktion fertig, Zielfortschritt; Client druckt mit Throttling; dazu `status`-Befehl mit Überblick), später ein kompaktes HUD-Einheiten-Panel.
> - **FoW-Rendering-Rework:** die separate schwebende Fog-Ebene (`client/src/render/fog.ts`, liegt bei `HEIGHT_SCALE + 0.5`) deckt bei geneigter Kamera nicht die ganze Karte — man schaut am Rand drunter durch (Screenshot 2026-07-17). Fix: die Verdunkelung wandert ins Terrain-Material (Shader-Hook `onBeforeCompile`, dieselbe Fog-DataTexture nach Welt-XZ gesamplet), Wasser-Ebene mitbehandelt. Außerdem klargestellt: **FoW ≠ Radar** — Radar wird ein eigenes Sensorsystem (Kontakte außerhalb der Sichtweite als Minimap-Blips, wie in Abschnitt 4 skizziert) und kommt in Session B.
> - **Session-Reihenfolge:** **A** = Gameplay-Loop v1 + UX-Fixes (FoW-Rework; Minimap-Klick/Drag zentriert Kamera wie in einem MMO + Kamera-Rechteck + Gebäude-Quadrate auf der Minimap; Gebäude deutlich größer als Einheiten, rein visuell; Event-Log) → **B** = Wirtschaft + POIs + Karte füllen + Radar + Feind-KI nutzt Gebäude/Produktion rudimentär → **C** = Meta (Startscreen mit Kampagnenwahl, Settings, Hilfe-Seite, Tutorial als geführte erste Mission, mehrere Spielstände, Progression/Achievements, HUD-Panel). Meta kommt bewusst zuletzt: erst wenn Loop und Fortschritt existieren, gibt es etwas zu speichern und freizuschalten.

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
- ~~Ob Spielstände zwischen Sitzungen gespeichert werden müssen~~ → entschieden (2026-07-17): **ja** — mehrere Spielstände, Kampagnen-Fortschritt und Achievements brauchen eine einfache serverseitige Persistenz (z. B. eine JSON-Datei pro Spielstand auf dem Pi). Umsetzung in Session C, siehe Kasten „Gameplay-Loop, Wirtschaft & Meta“ (Abschnitt 9).
- ~~Konkrete Marine-/Luftfahrt-Asset-Quelle noch zu recherchieren~~ → erledigt, siehe Abschnitt 7: PixVoxel-Pack deckt Marine + Luft ab; Sprites müssen noch extrahiert und in den Loader eingebunden werden.
- Echter Wasser-Shader: Wasser-Kacheln sind aktuell nur einfarbige Platzhalter-Säulen (siehe `client/src/render/terrain.ts`). Später ein animiertes Wasser-Material (Wellen-Bewegung, Transparenz/Reflexion) wie in Abschnitt 4 als `waterGroup` vorgesehen.
- Wetter-Partikelsystem (Regen, Schnee, Nebel o. ä.): noch nicht entworfen — Rendering-Ansatz (z. B. `THREE.Points` mit Textur-Atlas) und Performance-Budget für die iPad-GPU müssen noch geklärt werden, bevor das umgesetzt wird.
