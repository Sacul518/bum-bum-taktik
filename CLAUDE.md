# Projekt-Hinweise für Claude Code

Diese Datei ist Teil des Repos (nicht nur lokales Claude-Memory), damit sie auf jedem Gerät verfügbar ist, auf dem dieses Repo ausgecheckt wird. Ergänzt Lucas' globale Vorgaben.

## Architektur

Vollständige Architekturentscheidungen stehen in [`KONZEPT.md`](./KONZEPT.md) — dort nachlesen statt neu zu diskutieren. Kurzfassung der bewusst festgelegten, teuer-zu-ändernden Entscheidungen:

- Server: Node.js + TypeScript (kein Go) — geteilte Typen zwischen Client und Server
- Karte: groß, aber endlich, aus einem Seed generiert (kein unendliches Chunk-Streaming)
- Netzwerk: nur lokales WLAN, kein TLS/Port-Forwarding nötig
- Modus: Koop (Spieler vs. KI-Fraktion), kein PvP → kein strenges Anti-Cheat-Lockstep nötig

## Arbeitsweise in diesem Projekt

- **Keine Planungs-Subagenten für Architektur-/Konzeptarbeit.** Lucas will, dass Architektur- und Konzeptentscheidungen direkt im Hauptgespräch erarbeitet werden, nicht an einen Plan-Subagenten delegiert. Subagenten nur bei explizitem Wunsch oder bei echter Parallelarbeit an unabhängigen Modulen einsetzen.
- **Kleine Schritte, dann stoppen und verifizieren.** Bei mehrstufigen Implementierungen (z. B. Repo-Aufbau, neues Feature) nach jedem einzelnen Schritt anhalten, konkret und einfach erklären, was Lucas zum Testen tun/prüfen soll, und auf sein OK warten, bevor der nächste Schritt beginnt. Nicht mehrere Schritte ungefragt zusammenfassen, auch wenn es "effizienter" wäre.
