# Session-Plan (beschlossen 2026-07-17)

Dieser Plan wurde mit Lucas in der Plan-Session am 2026-07-17 festgelegt. Die
**Begründungen** zu den Entscheidungen stehen in [`KONZEPT.md`](./KONZEPT.md),
Kasten „Gameplay-Loop, Wirtschaft & Meta" (Abschnitt 9) — hier steht das
**Was und in welcher Reihenfolge**. Erledigte Aufgaben abhaken (`[x]`) und bei
Abweichungen kurz notieren, warum.

Kern-Entscheidungen: Kampagne zuerst (kein Skirmish), Wirtschaft mit **zwei**
Ressourcen (Credits aus Städten, Material aus Minen), Meta zuletzt (erst wenn
es Fortschritt zum Speichern gibt), Einheiten-Info erst als Terminal-Event-Log,
HUD-Panel später.

## Session A — Gameplay-Loop v1 + UX-Fixes (als Nächstes)

Reihenfolge einhalten, jede Aufgabe einzeln verifizieren + committen:

- [x] **1. FoW-Rework (Optik):** Die separate Fog-Ebene in
  `client/src/render/fog.ts` schwebt bei `HEIGHT_SCALE + 0.5` über dem Gelände —
  bei geneigter Kamera schaut man am Rand drunter durch, die Karte ist nicht
  voll bedeckt (Screenshot 2026-07-17). Fix: Verdunkelung ins Terrain-Material
  einbauen (`onBeforeCompile`-Shader-Hook in `render/terrain.ts`, dieselbe
  Fog-DataTexture nach Welt-XZ sampeln und die Fragmentfarbe abdunkeln),
  Wasser-/Brücken-Flächen mitbehandeln, die alte Ebene entfernen. Sichtkreise
  von Einheiten, Gebäuden und Recon-Sweeps müssen weiter funktionieren.
  *Erledigt 2026-07-17; Abweichung: der Hook sitzt zusätzlich auf den
  geteilten Modell-Materialien (`models.ts`), weil der Server alle Gebäude
  schickt — auch die im Nebel, die vorher nur die Ebene mit abdunkelte.
  Wasser/Brücken brauchten nichts Eigenes (Teil des einen Terrain-Meshes).*
- [x] **2. Minimap wie MMO** (`client/src/ui/minimap.ts` + `render/camera.ts`):
  Klick und Ziehen auf der Minimap zentriert die Kamera auf die entsprechende
  Weltposition (wie in League of Legends) — die Kamera braucht dafür ein
  `centerOn(x, z)`. Dazu: den aktuellen Kamera-Ausschnitt als Rechteck auf der
  Minimap zeichnen und Gebäude als kleine Quadrate in Fraktionsfarbe
  (grau = neutral). *Erledigt 2026-07-17: `centerCameraOn` +
  `getGroundViewportCorners` in camera.ts; der Ausschnitt ist wegen der
  Kameraneigung ein Parallelogramm, neu gezeichnet wird nur bei Bewegung.*
- [x] **3. Größenverhältnisse:** Gebäude sind kaum größer als Einheiten.
  Gebäude-Modelle in `client/src/render/buildings.ts` deutlich vergrößern
  (HQ/Fabrik ca. 2–3 Kacheln Grundfläche, Türme spürbar hoch), Einheiten
  (`render/models.ts`) unverändert oder minimal kleiner. Rein visuell —
  Server-Werte (`CAPTURE_RANGE` etc.) nicht anfassen. *Erledigt 2026-07-17:
  Skalierungsfaktor pro Typ (`MODEL_SCALE`) auf der Modellgruppe, Türme mit
  extra Höhen-Stretch; HP-/Capture-Balken wachsen mit. Einheiten unverändert.*
- [x] **4. Gameplay-Loop v1 — Missionsziele:** `shared/src/missions.ts` um
  `objective` (`destroyHQ` | `captureCities(n)` | `eliminateAll`) und einen
  Briefing-Text erweitern; der Server (`server/src/index.ts` / `gameLoop.ts`)
  prüft Sieg/Niederlage anhand des Ziels, Niederlage auch wenn das eigene HQ
  fällt; Briefing beim `mission start` im Terminal ausgeben; neuer
  `objective`-Befehl zeigt Ziel + Fortschritt (z. B. „Städte 1/3"). 2–3
  Missionen pro Region als Kette mit ansteigender Schwierigkeit; die
  Folge-Mission wird erst nach einem Sieg freigeschaltet (vorerst nur im
  Server-Speicher, Persistenz kommt in Session C; `missions` zeigt gesperrte
  Missionen als `[gesperrt]`). *Erledigt 2026-07-17: 9 Missionen (Plains 3,
  andere Regionen je 2), Freischalt-Logik in shared (`isMissionUnlocked`),
  Fortschritt kommt als `objectiveProgress` im StateUpdate, `missionEnd`
  nennt Niederlage-Grund (Einheiten/HQ) und schaltet die Folge-Mission frei.*
- [x] **5. Terminal-Event-Log + `status`:** Der Server schickt Spiel-Ereignisse
  im `StateUpdate` (`shared/src/protocol.ts`): Einheit unter Beschuss,
  Einheit/Gebäude verloren, Einnahme abgeschlossen (eigene und feindliche),
  Produktion fertig, Missionsziel-Fortschritt. Das Terminal druckt sie
  automatisch (auch bei geschlossenem Fenster puffern), mit Throttling —
  „unter Beschuss" pro Einheit höchstens alle paar Sekunden. Neuer
  `status`-Befehl: Tabelle aller eigenen Einheiten mit HP, Zustand
  (bewegt/kämpft/idle/eingestiegen) und Position. *Erledigt 2026-07-18:
  Erkennung per Tick-Diff auf dem Server, underFire serverseitig 5 s pro
  Einheit gedrosselt; Puffern übernimmt das bestehende Terminal-Scrollback.
  Abweichungen: „eingestiegen" erscheint als Passagier-Zahl beim Transport
  (Eingestiegene stehen bewusst nicht in Snapshots); dabei Bug gefixt:
  eliminateAll-Fortschritt wurde durch Feind-Nachproduktion negativ, zählt
  jetzt kumulierte Abschüsse (total = Abschüsse + lebende Feinde).*
- [x] **6. Falls noch Zeit — Balancing `erstkontakt`:** bekannt zu schwer
  (Spieler verlor 3 von 4 Testläufen) — `WEAPONS`/`MAX_HP` in
  `shared/src/constants.ts` anpassen und mit Testgefechten prüfen.
  *Erledigt 2026-07-18: Panzer 100→130 HP, Flugzeug 80→100 HP und
  Reichweite 5→6; Abweichung: zusätzlich Turmschaden 12→7 (Türme stehen nur
  an der Feindbasis, `eliminateAll` zwingt dorthin). Testgefechte per Bot:
  Spiel mit Angriffsbefehlen gewinnt 3/3; der reine Marschbefehl in die
  Feindbasis bleibt tödlich (Türme bestrafen Tatenlosigkeit — gewollt,
  Auto-Feuer zielt nicht auf Gebäude). Erkenntnis fürs Log: die Schwierigkeit
  war eine Klippe zwischen Fokus-Feuer und naivem Marsch, keine reine
  Zahlenfrage.*

## Session B — Wirtschaft, POIs & Karte

Alle sechs Aufgaben erledigt 2026-07-18 (Reihenfolge angepasst: POIs zuerst,
weil Minen-Einkommen und Produktionsgebäude sie brauchen). Details in
`ZUSAMMENFASSUNG.md`.

- [x] Zwei Ressourcen: **Credits** aus eingenommenen Städten, **Material** aus
  Minen; laufendes Einkommen pro Gebäude, Anzeige im HUD/Terminal.
  *Erledigt: `server/economy.ts`, Konto pro Fraktion; Abweichung: das HQ gibt
  zusätzlich +1 Credit/s Grundsold, damit keine Fraktion je trockenliegt.
  HUD oben rechts + `resources`-Befehl.*
- [x] Neue neutrale, einnehmbare POIs: **Mine, Kaserne, Hafen, Flugplatz**
  (gleiche Capture-Mechanik wie Städte/Fabriken). *Erledigt: 2 Minen, 1
  Kaserne, 1 Flugplatz, 1 Hafen (nur auf Kachel mit Wasser-Nachbar, entfällt
  sonst); Mindestabstand 6 zu anderen Gebäuden.*
- [x] Produktion kostet Ressourcen und passiert am passenden Gebäude:
  Kaserne→Infanterie, Fabrik→Panzer, Hafen→Boote, Flugplatz→Flugzeuge
  (ersetzt die bisherige Gratis-Infanterie-Produktion der Fabriken).
  *Erledigt: `produce`-Terminalbefehl, `produceResult` unicast, Baustatus im
  BuildingSnapshot; Einnahme bricht laufende Produktion ab.*
- [x] Karte füllen: Wälder/Felsen als Deko (Instanced Meshes — iPad-GPU-Budget
  beachten, siehe KONZEPT Abschnitt 4). *Erledigt: 3 Draw-Calls gesamt, Caps
  4000/2000, deterministischer Kachel-Hash, Freihalte-Zone um Gebäude.*
- [x] **Radar** als eigenes Sensorsystem: Kontakte außerhalb der Sichtweite als
  Blips auf der Minimap (KONZEPT Abschnitt 4) — FoW bleibt davon getrennt.
  *Erledigt: HQ Radius 40, eingenommener Flugplatz 30; anonyme gerundete
  Positionen, gelbe Hohlkreise auf der Minimap.*
- [x] Feind-KI nutzt Gebäude/Produktion rudimentär (nimmt Städte ein, greift
  Spieler-Gebäude an). *Erledigt: Strategie-Schicht alle 2 s in `ai.ts`
  (Infanterie nimmt ein, Kampfeinheiten belagern, Produktion vom
  enemy-Konto, Cap 16). Balance-Beobachtung: `erstkontakt` gewinnt sich im
  Leerlauf selbst, weil die KI in die Spieler-Waffen rennt — fürs nächste
  Balancing vormerken.*

## Session C — Meta

- [x] Startscreen mit Missions-/Kampagnenwahl (statt Terminal-Zwang beim Start).
  *Erledigt 2026-07-20: `client/src/ui/startscreen.ts` — Overlay im
  Terminal-Look, links Missionsketten pro Region ([x]/[ ]/[-]-Marker,
  gesperrte klickbar mit Erklaerung), rechts Briefing/Ziel/Truppe +
  Start-Button; "≡"-Button am linken Rand oeffnet es wieder. `missionEnd`
  oeffnet den Startscreen mit Ergebniszeile statt das Terminal aufzudraengen.
  Dabei Bug gefixt: das Terminal-Fenster startete default-sichtbar
  (`display: flex` in Terminal.ts), das bisherige `terminal.open()` beim
  Start war wirkungslos — startet jetzt mit `display: none`.*
- [x] Settings-Seite, Hilfe-Seite. *Erledigt 2026-07-20: als Tabs im
  Startscreen-Overlay (MISSIONEN | EINSTELLUNGEN | HILFE). Einstellungen in
  `ui/settings.ts` (localStorage, pro Geraet): Kamera-Tempo 0.5x-2x,
  Mausrad-Zoom umkehren, Waelder/Felsen an/aus (GPU-Last, wirkt sofort auf
  die decoGroup). Hilfe: Steuerung Maus/Touch/Tastatur, Spielablauf-
  Kurzregeln, Terminal-Befehlsliste aus der Registry (zweispaltig mit
  Umbruch).*
- [x] Tutorial: die erste Mission als geführte Einführung. *Erledigt
  2026-07-20: `client/src/ui/tutorial.ts` - Panel unten mittig, 6 Schritte
  (Kamera, Auswahl, Marsch, Angriff, Terminal, Ziel), jede Stufe wird durch
  die echte Aktion freigeschaltet (notify()-Hooks in main.ts), Ueberspringen
  moeglich; "erledigt" pro Geraet in localStorage, Missionssieg zaehlt auch.
  Offen (Balance, nicht Tutorial-Code): erstkontakt gewinnt sich teils in
  Sekunden von selbst (Feind-KI rennt in die Spieler-Waffen, bekannt aus
  Session B) - dann ist das Tutorial kaum sichtbar; Entscheidung bei Lucas.*
- [ ] Mehrere Spielstände: serverseitige Persistenz (z. B. JSON-Datei pro
  Spielstand auf dem Pi) für Kampagnen-Fortschritt.
- [ ] Progression + Achievements.
- [ ] Kompaktes HUD-Einheiten-Panel (Ergänzung zum Terminal-Event-Log).

## Arbeitsweise (gilt für jede Session)

Kleine Schritte, nach jedem Schritt verifizieren (typecheck/build,
Headless-Test gegen den Dev-Server, bei UI-Änderungen Browser-Test per
Sonnet-Subagent), pro Feature committen + pushen (deutsch, ohne
Co-Authored-By), danach `ZUSAMMENFASSUNG.md`, diese Datei (Haken setzen) und
`txt.txt` aktualisieren und die Dev-Server beenden. Nichts aus späteren
Sessions vorziehen.
