# Zusammenfassung der autonomen Session (2026-07-16/17)

Auftrag: 5 priorisierte Aufgaben abarbeiten — Raycasting-Bugfix, Terminal-Upgrades,
3D-Modelle & Waffen, Transport, Gebäude & Basen. Alle 5 sind fertig, verifiziert
und gepusht. Hier steht, **was** getan wurde, **wie** es verifiziert wurde und
**wie du es selbst testen kannst**.

## Was ist neu (aus Spieler-Sicht)

1. **Klicks treffen jetzt das echte Gelände** (Commit `2a7d4fe`) — vorher wurde gegen eine flache y=0-Ebene geraycastet: bei geneigter Kamera und Hügeln/Senken landete der Move-Befehl auf der falschen Kachel. Jetzt echtes 3D-Raycasting gegen das Höhenfeld.
2. **Terminal wie eine echte Shell** (Commit `128a067`) — Tab-Vervollständigung für Befehle UND Argumente (z. B. `board bo<Tab>` → `boat-1`), Ghost-Vorschlag in Grau hinter der Eingabe, Befehls-History mit Pfeiltasten, „Error Lens": fehlerhafte Token werden rot unterstrichen mit Meldung, „meintest du …?" bei Tippfehlern.
3. **Echte 3D-Modelle statt Sprites** (Commit `6c2f9cc`) — Panzer (Ketten, Turm, Rohr), Infanterie, Boot (Rumpf mit Bug, Geschütz), Flugzeug (Tragflächen, Kanzel) als prozedurale Low-Poly-Modelle aus Three.js-Primitiven. Olivgrün = du, Rostrot = Feind. Dazu Licht (Hemisphären- + Richtungslicht).
4. **Waffensystem** (ebenfalls `6c2f9cc`) — jede Einheit hat genau eine Waffe mit Reichweite, Schaden, Feuerpause, erlaubten Ziel-Domains und Bonus-Schaden: Panzerkanone (kann NICHT auf Flugzeuge), Sturmgewehr (einzige Boden-Flugabwehr), Schiffsgeschütz (Reichweite 8), Raketen (trifft alles, Bonus gegen Boote). Tracer-Farben pro Waffe (orange/gelb/rot).
5. **Transport** (Commit `401ab83`) — Infanterie steigt in Boot (4 Plätze) oder Flugzeug (2) ein: Klick auf den eigenen Transporter (wenn nur Infanterie ausgewählt ist) oder Terminal `board <id>` / `unboard`. Eingestiegene sind unsichtbar und unangreifbar, sterben aber mit dem Transporter. Weiße Punkte über dem HP-Balken zeigen die Belegung.
6. **Gebäude & Basen** (Commit `81e005c`) — auf jeder Karte: dein HQ + Fabrik nahe der Mitte, Feind-HQ + Fabrik + 2 Wachtürme weit weg, 3 neutrale Städte dazwischen.
   - **Zerstörbar**: Klick auf feindliches/neutrales Gebäude = Angriffsbefehl.
   - **Einnehmbar**: Infanterie neben Fabrik/Stadt (3 Kacheln) nimmt sie in 8 s ein (gelber Fortschrittsbalken); das Gebäude wechselt Farbe und Fraktion.
   - **Sicht**: deine Gebäude stanzen Sichtkreise in den Fog of War.
   - **Produktion**: Fabriken spawnen alle 30 s eine Infanterie ihrer Fraktion (max. 5 pro Fabrik) — auch die Feind-Fabrik!
   - **Wachtürme** feuern hellblaue Flak (Reichweite 7) auf alles, was sich nähert — ein Flugzeug allein überlebt den Anflug aufs Feind-HQ nicht.
   - Terminal-Befehl `buildings` zeigt alle Gebäude mit HP und Einnahme-Status.

## So testest du es (5 Minuten)

```
npm run dev          # in zwei Terminals: --workspace=packages/server und --workspace=packages/client
```

1. http://localhost:5173 öffnen → neben deinen Einheiten stehen HQ (Bunker mit Antenne) und Fabrik (Halle mit Schornstein) in Olivgrün.
2. `buildings` im Terminal → Tabelle mit 9 Gebäuden und Positionen.
3. Terminal schließen (Escape), Infanterie anklicken, dann zu einer grauen Häusergruppe (neutrale Stadt) schicken → daneben stehen lassen → gelber Balken füllt sich, nach 8 s wird die Stadt grün (deine!) und ihr Sichtkreis lichtet den Nebel.
4. Infanterie anklicken, dann aufs Boot klicken → sie läuft hin und steigt ein (weißer Punkt überm Boot). Boot irgendwohin fahren, `unboard` im Terminal → sie steigt wieder aus.
5. Panzer auswählen, auf eine Stadt/das Feind-HQ klicken → er fährt hin und schießt es kaputt (HP-Balken am Gebäude).
6. Warte 30 s → neben deiner Fabrik erscheint eine neue Infanterie-Einheit (`infantry-p1`).
7. Tab-Taste im Terminal ausprobieren: `bo<Tab>` → `board`, dann nochmal Tab → Transporter-IDs.

## Wie es verifiziert wurde

- `npm run typecheck && npm run build` nach jedem Schritt — grün.
- **Headless-E2E-Tests** (echte WebSocket-Clients gegen den laufenden Server):
  - Raycasting: 7/7, Terminal: 23/23, Waffen: 24/24 (Domain-Regeln, Bonus-Schaden, Cooldowns), Transport: 9/9 (inkl. Fern-Anlauf: Infanterie läuft 8+ Kacheln zum Boot), **Gebäude: 13/13** (Platzierung, Capture mit Fortschritt, Turm-Flak, Fabrik-Produktion, Gebäude-Zerstörung), Fog/Recon-Regressionen: grün.
- **Browser-Tests** (Chrome, per Subagent): Transport (board/unboard, Passagier-Punkte, keine JS-Fehler) und Gebäude (9 Gebäude gerendert, `buildings`-Tabelle, HQ/Fabrik/Städte optisch korrekt, keine JS-Fehler) — alle Schritte PASS.

## Technische Details (wo was liegt)

| Bereich | Dateien |
|---|---|
| Waffenprofile, Transport-, Gebäude-Konstanten | `packages/shared/src/constants.ts` (`WEAPONS`, `TRANSPORT_CAPACITY`, `BUILDINGS`, `TOWER_WEAPON`) |
| Gebäude-Logik (Platzierung/Capture/Produktion/Turm) | `packages/server/src/buildings.ts` |
| Transport + Gebäude-Angriffsziele + Fabrik-Spawn | `packages/server/src/gameLoop.ts` |
| Sichtquellen (Einheiten + Gebäude + Recon) | `packages/server/src/visibility.ts`, `packages/client/src/render/fog.ts` |
| Prozedurale Modelle | `packages/client/src/render/models.ts` (Einheiten), `render/buildings.ts` (Gebäude) |
| Terminal-Autocomplete/Error-Lens | `packages/client/src/terminal/registry.ts` + `commands/*.ts` |
| Neue Terminal-Befehle | `commands/transport.ts` (`board`/`unboard`), `commands/buildings.ts` |

Alle Design-Entscheidungen mit Begründung: `docs/KONZEPT.md`, Kästen „entschieden & umgesetzt" (zuletzt: „Gebäude & Basen", 2026-07-17).

## Für dich notiert (Balancing/Beobachtungen)

- **Mission `erstkontakt` ist hart**: Im Browser-Test verlor der Spieler 3 von 4 Läufen gegen die 2 Feind-Einheiten. Wenn du das auch so empfindest: Stellschrauben sind `WEAPONS`/`MAX_HP` in `shared/src/constants.ts`.
- Die Feind-Fabrik produziert bis zu 5 zusätzliche Feind-Infanteristen pro Karte — freie Karten werden dadurch lebendiger, Missionen bleiben unberührt (Sieg zählt weiterhin nur Einheiten, nicht Gebäude).
- Ungeschützte Infanterie beim Einnehmen wird von der Feind-KI angegriffen (im Test passiert) — Eskorte mitschicken lohnt sich.

## Offene Punkte (bewusst nicht gemacht)

- Sieg/Niederlage hängt nur an Einheiten — „HQ zerstören" als Missionsziel wäre der nächste logische Schritt.
- Feind-KI ignoriert Gebäude (greift nicht an, nimmt nicht ein).
- Gebäude auf der Minimap fehlen noch.
- Sonar/U-Boote, Wasser-Shader, PWA, Grafik-Feinschliff (Phase 3/4).
