# Zusammenfassung der Session (2026-07-18) — Session B aus docs/PLAN.md

Auftrag: Session B „Wirtschaft, POIs & Karte" (alle 6 Aufgaben aus
[`docs/PLAN.md`](./docs/PLAN.md)). **Alle 6 sind fertig, verifiziert und
gepusht.** Hier steht, **was** getan wurde, **wie** es verifiziert wurde und
**wie du es selbst testen kannst**.

## Was ist neu (aus Spieler-Sicht)

1. **Neue neutrale POIs** (Commit `00df36c`) — Mine, Kaserne, Hafen,
   Flugplatz stehen jetzt zusätzlich zu Städten/Fabriken auf der Karte,
   gleiche Einnahme-Mechanik (Infanterie in Reichweite). Eigene Modelle:
   Mine mit Förderturm + Abraumhaufen, Kaserne mit zwei Baracken + Fahne,
   Hafen mit Kranmast an der Küste, Flugplatz mit Landebahn + Tower. Der
   Hafen entfällt auf Karten ohne Wasser in der Nähe (z. B. Wüste/Gebirge).
2. **Wirtschaft: Credits + Material** (Commit `b97ca54`) — HUD oben rechts
   zeigt den Kontostand (`$ 150    # 60` zu Beginn). Credits kommen aus
   Städten (+2/s) und einem HQ-Grundsold (+1/s, damit niemand je
   trockenliegt), Material nur aus Minen (+1/s pro Mine). Neuer Befehl
   `resources` zeigt Kontostand plus Einkommensquellen im Detail.
3. **Produktion kostet Ressourcen** (Commit `18aace7`) — die alte
   Gratis-Infanterie der Fabriken ist weg. Neuer Befehl `produce <einheit>
   [gebäudeId]`: Kaserne baut Infanterie (30 Credits), Fabrik Panzer (80+40
   Material), Hafen Boote (70+30), Flugplatz Flugzeuge (100+50) — jeweils am
   ersten freien eigenen Gebäude des passenden Typs. `produce` ohne
   Argumente zeigt die Kostentabelle. Läuft ein Bau, zeigt `buildings` den
   Fortschritt in Prozent. Wird ein Gebäude erobert, verfällt eine laufende
   Produktion des alten Besitzers.
4. **Karte wirkt belebter** (Commit `b60390e`) — Bäume auf Ebenen/Hügeln,
   Felsen auf Hügeln/Bergen/Sand, als Instanced Meshes (nur 3 Draw-Calls
   für die ganze Karte). Deterministisch aus den Kachelkoordinaten
   gehasht, sieht bei jedem Neuladen gleich aus. Um Gebäude bleibt eine
   Freifläche.
5. **Radar als eigenes Sensorsystem** (Commit `d08606b`) — getrennt vom Fog
   of War: HQ und ein eigener Flugplatz erkennen Feinde in großem Radius
   (40 bzw. 30 Kacheln) als anonyme gelbe Hohlkreise auf der Minimap, auch
   wenn keine eigene Einheit sie tatsächlich sieht. Zeigt nur "da ist
   etwas", keine Einheiten-Info, kein 3D-Rendering.
6. **Feind-KI nutzt Gebäude** (Commit `ad826ed`) — alle 2 Sekunden
   entscheidet die Feind-KI neu: freie Infanterie marschiert zum nächsten
   einnehmbaren fremden Gebäude, Kampfeinheiten ohne Ziel belagern
   Spieler-Gebäude, freie Feind-Produktionsgebäude bestellen Einheiten vom
   eigenen Konto (Cap 16 Einheiten gegen Karten-Flutung). Eine
   Spieler-Einheit in Aggro-Reichweite hat weiter Vorrang vor dem
   Gebäude-Ziel.

## So testest du es (5 Minuten)

```
npm run dev --workspace=packages/server   # Terminal 1
npm run dev --workspace=packages/client   # Terminal 2
```

1. http://localhost:5173 öffnen — oben rechts läuft der Ressourcen-Zähler
   hoch. `resources` im Terminal zeigt die Aufschlüsselung.
2. `buildings` → mine-1, mine-2, barracks-1, airfield-1, harbor-1 stehen in
   der Liste (neutral). Herauszoomen: Bäume/Felsen sind auf der Karte
   verteilt, die POI-Modelle sehen unterschiedlich aus.
3. `produce` → Kostentabelle. `produce infantry` → Ablehnung ("brauchst
   eine Kaserne"). `produce tank` → "Produktion gestartet ... 15s", Kosten
   werden sofort abgezogen. `buildings` zeigt "baut tank (X%)" bei
   factory-player. Nach 15s: `status` zeigt die neue Einheit.
4. Minimap beobachten: nach einer Weile tauchen gelbe Hohlkreise auf (Radar
   erkennt Feinde weiter weg, bevor sie sichtbar sind).
5. Ein paar Minuten laufen lassen: die Feind-KI nimmt Gebäude ein
   (`buildings` zeigt Fraktionswechsel), Feindeinheiten laufen Richtung
   Spieler-Basis statt stumpf stehen zu bleiben.

## Wie es verifiziert wurde

- `npm run build` (tsc + vite) nach jedem der 6 Schritte — grün.
- **Headless-Tests** (echte WebSocket-Clients gegen den Dev-Server), je
  einer pro Feature: POI-Platzierung (alle 5 neutral), Einkommen (+6
  Credits in 6s bei ruhendem Konto), Produktion (alle 4 Ablehnungsgründe,
  Kostenabzug, Spawn nach Bauzeit neben dem Gebäude, keine Gratis-Infanterie
  mehr), Radar (Kontakte nur im Radius, keine Feind-Entities im Snapshot),
  Feind-KI (Produktion nach 1s, Angriff nach 4s, Einnahme nach 10s — alle
  drei Verhaltensweisen in einem 90s-Lauf beobachtet).
- **Browser-Test** (Chrome, per Sonnet-Subagent): HUD, Deko, POI-Modelle,
  alle Terminal-Befehle, Konsole — alle Prüfpunkte PASS, keine
  Konsolenfehler. Radar-Blips konnten im Testfenster nicht visuell
  bestätigt werden (kein Feind stand zufällig in der Radar-only-Zone),
  Code-Pfad ist aber durch den Headless-Test verifiziert.

## Für dich notiert (Beobachtungen)

- **`erstkontakt` gewinnt sich im Leerlauf oft selbst:** Weil die
  Feind-KI jetzt aktiv auf die Spieler-Basis zumarschiert, läuft sie der
  automatischen Abwehr (Auto-Feuer der Spieler-Einheiten) in die Waffen —
  ein 90-Sekunden-Testlauf ganz ohne Spielereingriff endete mit Sieg. Für
  das nächste Balancing vormerken: entweder ist das gewünscht ("die KI
  greift jetzt wirklich an"), oder die frühen Missionen brauchen einen
  Vorsprung, damit ein Sieg noch Spielleistung erfordert.
- **Hafen-Farbe im Browser-Test als "rostrot" beschrieben:** Der Code setzt
  für neutrale Gebäude durchgehend Grautöne (`primaryColor`/
  `secondaryColor` in `render/buildings.ts`); die wahrscheinlichste
  Erklärung ist, dass der Test-Agent stattdessen `mine-2` gesehen hat, die
  während der langen Testsession von der KI erobert wurde (daher rot).
  Beim nächsten visuellen Test kurz gegenchecken, ob der Hafen tatsächlich
  grau ist.
- Der Feind hat jetzt ein eigenes Ressourcenkonto (`economy.ts`,
  `startProduction('enemy', ...)`) — bei künftigen Balance-Änderungen an
  `UNIT_COST`/`BUILDING_INCOME_PER_S` wirken sie auf beide Fraktionen
  gleich.

## Technische Details (wo was liegt)

| Bereich | Dateien |
|---|---|
| Neue POI-Typen + Werte | `packages/shared/src/types.ts` (`BuildingType`), `constants.ts` (`BUILDINGS`) |
| POI-Platzierung | `packages/server/src/buildings.ts` (`initBuildings`, Mindestabstand, Hafen-Wasser-Check) |
| POI-Modelle | `packages/client/src/render/buildings.ts` (`buildMine`/`buildBarracks`/`buildHarbor`/`buildAirfield`) |
| Wirtschaft (Konten, Einkommen) | `packages/server/src/economy.ts`, `shared/src/constants.ts` (`START_RESOURCES`, `BUILDING_INCOME_PER_S`) |
| Ressourcen-HUD | `packages/client/src/ui/resources.ts`, Terminal-Befehl `commands/resources.ts` |
| Produktion (Kosten, Bauzeit, Belegung) | `packages/server/src/buildings.ts` (`startProduction`), `shared/src/constants.ts` (`PRODUCTION_BUILDING`/`UNIT_COST`/`PRODUCTION_TIME_MS`) |
| Produktions-Protokoll | `shared/src/protocol.ts` (`ProduceCommand`/`ProduceResultMessage`), Terminal-Befehl `commands/produce.ts` |
| Karten-Deko | `packages/client/src/render/deco.ts` (Instanced Meshes, Hash-Platzierung) |
| Radar (Server + Minimap) | `packages/server/src/visibility.ts` (`computeRadarContacts`), `shared/src/constants.ts` (`RADAR_RANGE`), `packages/client/src/ui/minimap.ts` |
| Feind-KI-Strategie | `packages/server/src/ai.ts` (`updateEnemyStrategy`) |

Die vollständige Session-A-Historie (Gameplay-Loop v1, FoW-Rework, Minimap-
Navigation, Terminal-Event-Log) steht im Git-Log der Commits vor `00df36c`.
