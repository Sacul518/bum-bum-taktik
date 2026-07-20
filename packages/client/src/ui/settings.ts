// Client-Einstellungen (PLAN.md Session C, Settings-Seite): gespeichert in
// localStorage, also pro Geraet/Browser - Spielstaende und Kampagnen-
// Fortschritt liegen dagegen auf dem Server. Aenderungen wirken sofort:
// main.ts liest die Werte im Renderloop bzw. haengt sich per
// onSettingsChange an (Deko-Sichtbarkeit).

export interface GameSettings {
  /** Faktor auf Schwenk-/Dreh-/Neige-Tempo der Kamera (1 = Standard). */
  cameraSpeed: number;
  /** Mausrad-Zoomrichtung umkehren. */
  invertZoom: boolean;
  /** Waelder/Felsen rendern - aus spart GPU-Last (iPad, KONZEPT Abschnitt 4). */
  showDecoration: boolean;
}

const DEFAULTS: GameSettings = {
  cameraSpeed: 1,
  invertZoom: false,
  showDecoration: true,
};

const STORAGE_KEY = 'bbt-settings';

// localStorage kann fehlen oder werfen (Safari Private Mode, volle Quota) -
// dann laeuft das Spiel einfach mit Defaults weiter, ohne Persistenz.
function load(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      cameraSpeed: typeof parsed.cameraSpeed === 'number' && parsed.cameraSpeed > 0 ? parsed.cameraSpeed : DEFAULTS.cameraSpeed,
      invertZoom: typeof parsed.invertZoom === 'boolean' ? parsed.invertZoom : DEFAULTS.invertZoom,
      showDecoration: typeof parsed.showDecoration === 'boolean' ? parsed.showDecoration : DEFAULTS.showDecoration,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();
const listeners = new Set<(settings: GameSettings) => void>();

export function getSettings(): GameSettings {
  return settings;
}

export function updateSettings(patch: Partial<GameSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nicht speicherbar (s. o.) - die Session behaelt den Wert trotzdem.
  }
  for (const listener of listeners) listener(settings);
}

export function onSettingsChange(listener: (settings: GameSettings) => void): void {
  listeners.add(listener);
}
