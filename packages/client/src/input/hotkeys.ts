// Hotkey-Tabelle fuer die Kamera (docs/KONZEPT.md Abschnitt 5.2): Taste -> Achse,
// statt einzelner if(pressedKeys.has('w')) - Abfragen im Renderloop. Neue Taste
// bedeutet eine neue Zeile in CAMERA_HOTKEYS statt einer neuen Verzweigung dort.
export type CameraAxis = 'pan-forward' | 'pan-right' | 'rotate' | 'tilt';

export interface CameraHotkey {
  axis: CameraAxis;
  sign: 1 | -1;
}

export const CAMERA_HOTKEYS: Record<string, CameraHotkey> = {
  w: { axis: 'pan-forward', sign: 1 },
  s: { axis: 'pan-forward', sign: -1 },
  d: { axis: 'pan-right', sign: 1 },
  a: { axis: 'pan-right', sign: -1 },
  q: { axis: 'rotate', sign: -1 },
  e: { axis: 'rotate', sign: 1 },
  r: { axis: 'tilt', sign: 1 },
  f: { axis: 'tilt', sign: -1 },
};

export interface CameraAxisInput {
  panForward: number;
  panRight: number;
  rotate: number;
  tilt: number;
}

// Summiert alle aktuell gehaltenen Tasten zu einer Achsen-Eingabe auf. Bleiben
// mehrere Tasten fuer dieselbe Achse gleichzeitig gedrueckt (z. B. Q und E),
// heben sich ihre Vorzeichen auf - das entspricht dem bisherigen Verhalten.
export function resolveCameraInput(pressedKeys: ReadonlySet<string>): CameraAxisInput {
  const input: CameraAxisInput = { panForward: 0, panRight: 0, rotate: 0, tilt: 0 };
  for (const key of pressedKeys) {
    const hotkey = CAMERA_HOTKEYS[key];
    if (!hotkey) continue;
    switch (hotkey.axis) {
      case 'pan-forward':
        input.panForward += hotkey.sign;
        break;
      case 'pan-right':
        input.panRight += hotkey.sign;
        break;
      case 'rotate':
        input.rotate += hotkey.sign;
        break;
      case 'tilt':
        input.tilt += hotkey.sign;
        break;
    }
  }
  return input;
}
