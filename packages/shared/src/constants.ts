import type { BuildingType, Domain, ProjectileKind, UnitType } from './types.js';

export const TICK_RATE_HZ = 12;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ;

export const DEFAULT_SERVER_PORT = 8081;

export const DOMAINS = ['land', 'water', 'air'] as const;

// Welche Domain (Begehbarkeits-Raster) fuer welchen Einheitentyp gilt -
// zentral hier statt verstreut, damit Server (Pathfinding) und Client
// (Rendering) dieselbe Zuordnung verwenden.
export const UNIT_DOMAIN: Record<UnitType, Domain> = {
  tank: 'land',
  infantry: 'land',
  boat: 'water',
  plane: 'air',
};

// Lebenspunkte pro Einheitentyp (docs/KONZEPT.md Abschnitt 9, Phase 2).
// Balancing 2026-07-18 (PLAN.md Session A, Aufgabe 6): Panzer und Flugzeug
// angehoben, damit die Anfaenger-Spielweise (Marschbefehl ohne Fokus-Feuer)
// den gebuendelten Feind-Aggro und das Turmfeuer lange genug uebersteht -
// im Testgefecht starb der Panzer sonst in ~4s an zwei fokussierenden
// Feinden. Infanterie bewusst bei 60: sie wird von Fabriken nachproduziert,
// ein Buff staerkt auch den Feind-Nachschub.
export const MAX_HP: Record<UnitType, number> = {
  tank: 130,
  infantry: 60,
  boat: 120,
  plane: 100,
};

// Waffensystem (Aufgabe "3D-Modelle & Waffen-System"): jede Einheit hat
// genau EINE Waffe mit eigenem Verhalten. "targets" legt fest, welche
// Domains die Waffe ueberhaupt treffen kann - ein Panzer kann z. B. nicht
// auf Flugzeuge schiessen. "bonusVs" ist ein Schadens-Multiplikator gegen
// bestimmte Einheitentypen. Reichweite in Kacheln, Feuerpause in ms.
// Startwerte fuers Balancing - werden nach Testgefechten angepasst.
export interface WeaponProfile {
  name: string;
  range: number;
  damage: number;
  cooldownMs: number;
  /** Domains, die diese Waffe treffen kann. */
  targets: readonly Domain[];
  /** Schadens-Multiplikator gegen bestimmte Ziel-Typen (fehlt = 1.0). */
  bonusVs?: Partial<Record<UnitType, number>>;
  /** Tracer-Optik im Client. */
  projectile: ProjectileKind;
}

export const WEAPONS: Record<UnitType, WeaponProfile> = {
  // Panzerkanone: panzerbrechend, aber machtlos gegen Luftziele.
  tank: { name: 'Kanone', range: 6, damage: 25, cooldownMs: 2000, targets: ['land', 'water'], bonusVs: { tank: 1.4 }, projectile: 'shell' },
  // Sturmgewehr: schwach, aber schnell; kann als einzige Bodenwaffe auch
  // (notduerftig) auf Flugzeuge halten - macht Infanterie zur Flugabwehr.
  infantry: { name: 'Sturmgewehr', range: 4, damage: 8, cooldownMs: 1000, targets: ['land', 'air'], bonusVs: { infantry: 1.5 }, projectile: 'bullet' },
  // Schiffsgeschuetz: groesste Reichweite, langsamer Nachlademodus.
  boat: { name: 'Schiffsgeschuetz', range: 8, damage: 30, cooldownMs: 2500, targets: ['land', 'water'], projectile: 'shell' },
  // Luft-Boden-Raketen: trifft alles, besonders wirksam gegen Schiffe.
  // Reichweite beim Balancing 2026-07-18 von 5 auf 6 angehoben (= Panzer-
  // kanone): im Testgefecht schwebte das Flugzeug 1-2 Kacheln ausserhalb
  // seiner Reichweite neben einem Feind-Panzer und starb am Turmfeuer, ohne
  // dass das Auto-Feuer je ausloeste.
  plane: { name: 'Raketen', range: 6, damage: 15, cooldownMs: 1500, targets: ['land', 'water', 'air'], bonusVs: { boat: 1.5 }, projectile: 'rocket' },
};

// Transport (Aufgabe "Infanterie-/Fahrzeug-Interaktion"): nur Infanterie
// kann einsteigen, nur Boot und Flugzeug nehmen Passagiere. Eingestiegene
// Einheiten sind unsichtbar, unverwundbar (sterben aber mit dem Transport!)
// und tragen nichts zur Sicht bei. EMBARK_RANGE in Kacheln: ab dieser
// Distanz zum Transport steigt die anlaufende Infanterie ein - gross genug,
// dass eine Landkachel neben einer Wasserkachel (diagonal 1.41) reicht.
export const TRANSPORT_CAPACITY: Record<UnitType, number> = {
  tank: 0,
  infantry: 0,
  boat: 4,
  plane: 2,
};
export const EMBARK_RANGE = 2;

/** Kann dieser Angreifer-Typ diesen Ziel-Typ ueberhaupt treffen? */
export function canTarget(attacker: UnitType, target: UnitType): boolean {
  return WEAPONS[attacker].targets.includes(UNIT_DOMAIN[target]);
}

/** Effektiver Schaden inkl. bonusVs-Multiplikator, auf ganze HP gerundet. */
export function weaponDamage(attacker: UnitType, target: UnitType): number {
  const weapon = WEAPONS[attacker];
  return Math.round(weapon.damage * (weapon.bonusVs?.[target] ?? 1));
}

// Gebaeude & Basen (Aufgabe 5): pro Karte stehen fest platzierte Gebaeude
// (server/buildings.ts) - Hauptquartiere und Fabriken beider Fraktionen,
// Wachtuerme am Feind-HQ, neutrale Staedte. Alle sind zerstoerbar; "vision"
// zaehlt nur fuer Gebaeude der Spieler-Fraktion (Fog of War); einnehmbare
// Gebaeude wechseln per Infanterie-Capture die Fraktion.
export interface BuildingProfile {
  name: string;
  maxHp: number;
  /** Sichtweite in Kacheln (nur Spieler-Gebaeude tragen zur Sicht bei). */
  vision: number;
  /** Einnehmbar durch Infanterie in CAPTURE_RANGE? */
  capturable: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingProfile> = {
  hq: { name: 'Hauptquartier', maxHp: 500, vision: 12, capturable: false },
  factory: { name: 'Fabrik', maxHp: 300, vision: 8, capturable: true },
  city: { name: 'Stadt', maxHp: 250, vision: 6, capturable: true },
  tower: { name: 'Wachturm', maxHp: 200, vision: 10, capturable: false },
  // Wirtschafts-POIs (PLAN.md Session B): starten neutral, gleiche
  // Capture-Mechanik wie Staedte/Fabriken.
  mine: { name: 'Mine', maxHp: 250, vision: 6, capturable: true },
  barracks: { name: 'Kaserne', maxHp: 300, vision: 7, capturable: true },
  harbor: { name: 'Hafen', maxHp: 300, vision: 8, capturable: true },
  airfield: { name: 'Flugplatz', maxHp: 300, vision: 8, capturable: true },
};

// Einnahme: Infanterie einer fremden Fraktion in CAPTURE_RANGE fuellt den
// Fortschritt; ohne anwesende Infanterie faellt er wieder ab. Stehen beide
// Fraktionen gleichzeitig daneben, pausiert die Einnahme (umkaempft).
export const CAPTURE_RANGE = 3;
export const CAPTURE_TIME_MS = 8_000;

// Wirtschaft (PLAN.md Session B, Hintergrund KONZEPT Abschnitt 9): zwei
// Ressourcen. Credits kommen aus Staedten (+ kleiner HQ-Grundsold, damit
// keine Fraktion je komplett trockenliegt), Material NUR aus Minen - wer
// Fahrzeuge bauen will, muss eine Mine halten. Werte sind Startwerte fuers
// Balancing.
export interface ResourceAmount {
  credits: number;
  material: number;
}

export const START_RESOURCES: ResourceAmount = { credits: 150, material: 60 };

/** Laufendes Einkommen pro Sekunde und Gebaeude (nur nicht-neutrale Besitzer). */
export const BUILDING_INCOME_PER_S: Partial<Record<BuildingType, Partial<ResourceAmount>>> = {
  hq: { credits: 1 },
  city: { credits: 2 },
  mine: { material: 1 },
};

// Wachturm: einziges Gebaeude mit Waffe, feuert auf die naechste Einheit
// der Gegenseite (alle Domains - Flak trifft auch Bodenziele). Schaden beim
// Balancing 2026-07-18 von 12 auf 7 gesenkt: Tuerme stehen nur an der
// Feindbasis, und eliminateAll zwingt dorthin (nachproduzierte Infanterie
// spawnt an der Feind-Fabrik) - mit 2x12 Schaden rissen die beiden Tuerme
// Infanterie und Flugzeug im Testgefecht in wenigen Sekunden.
export const TOWER_WEAPON = {
  name: 'Flak',
  range: 7,
  damage: 7,
  cooldownMs: 1200,
  projectile: 'flak' as ProjectileKind,
} as const;

// Produktion (PLAN.md Session B): Einheiten kosten Ressourcen und entstehen
// am passenden Gebaeude - ersetzt die fruehere Gratis-Infanterie der
// Fabriken. Ein Gebaeude baut immer genau eine Einheit gleichzeitig.
export const PRODUCTION_BUILDING: Record<UnitType, BuildingType> = {
  infantry: 'barracks',
  tank: 'factory',
  boat: 'harbor',
  plane: 'airfield',
};

// Infanterie kostet bewusst kein Material: sie bleibt auch ohne Mine
// produzierbar (nur Kaserne + Credits noetig), Fahrzeuge nicht.
export const UNIT_COST: Record<UnitType, ResourceAmount> = {
  infantry: { credits: 30, material: 0 },
  tank: { credits: 80, material: 40 },
  boat: { credits: 70, material: 30 },
  plane: { credits: 100, material: 50 },
};

export const PRODUCTION_TIME_MS: Record<UnitType, number> = {
  infantry: 8_000,
  tank: 15_000,
  boat: 15_000,
  plane: 20_000,
};

// Sichtweite in Kacheln pro Einheitentyp - Grundlage fuer Fog of War
// (docs/KONZEPT.md Abschnitt 9, Phase 2): der Server schickt Feind-Einheiten
// nur, wenn mindestens eine Spieler-Einheit sie in Sichtweite hat. Der
// Huegel-Sichtbonus aus Abschnitt 3 kommt spaeter als Aufschlag obendrauf.
export const VISION_RANGE: Record<UnitType, number> = {
  tank: 10,
  infantry: 8,
  boat: 12,
  plane: 16,
};

// Gegner-KI: ab dieser Distanz (Kacheln) nimmt eine Feind-Einheit die
// naechste Spieler-Einheit ins Visier und verfolgt sie. Bewusst groesser als
// jede Waffen-Reichweite (sonst gaebe es keine Verfolgung) und groesser als
// die Sichtweite der Bodeneinheiten: Panzer/Infanterie koennen von Feinden
// ueberrascht werden, die sie noch nicht sehen - nur der Aufklaerer (plane,
// Sichtweite 16) entdeckt Feinde, bevor die aggro werden. Das macht
// Aufklaerung wertvoll.
export const ENEMY_AGGRO_RANGE = 14;

// Hacking-Minispiel (docs/KONZEPT.md Abschnitt 9, Phase 3). Startwerte fuers
// Balancing: Der Zugriffscode (HACK_CODE_BYTES Hex-Bytes) muss innerhalb
// HACK_TIME_LIMIT_MS nachgetippt werden; Erfolg legt das Ziel HACK_STUN_MS
// lahm. HACK_RANGE bewusst groesser als jede Waffen-Reichweite (max. 8),
// damit man aus sicherer Entfernung hacken kann - aber kleiner als
// ENEMY_AGGRO_RANGE (14): wer nah genug zum Hacken ist, riskiert Aggro.
export const HACK_RANGE = 12;
export const HACK_TIME_LIMIT_MS = 12_000;
export const HACK_STUN_MS = 8_000;
export const HACK_CODE_BYTES = 4;

// Aufklaerungs-Sweep "recon" (docs/KONZEPT.md Abschnitt 6): deckt einen
// Kartenbereich voruebergehend auf (Fog of War + Feind-Sichtbarkeit), danach
// Abklingzeit fuers ganze Team. Startwerte fuers Balancing.
export const RECON_RADIUS_DEFAULT = 15;
export const RECON_RADIUS_MAX = 25;
export const RECON_DURATION_MS = 10_000;
export const RECON_COOLDOWN_MS = 60_000;

// Schwellenwerte fuer den Hoehenwert e (-1..1) aus der Terrain-Generierung,
// siehe docs/KONZEPT.md Abschnitt 3.
export const ELEVATION_THRESHOLDS = {
  deepWaterMax: -0.2,
  shallowWaterMax: 0.0,
  beachMax: 0.02,
  plainsMax: 0.4,
  hillsMax: 0.7,
} as const;
