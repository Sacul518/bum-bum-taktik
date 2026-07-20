// Tutorial (PLAN.md Session C): die erste Mission als gefuehrte Einfuehrung.
// Ein kleines Panel unten in der Bildmitte nennt genau EINE Aufgabe; main.ts
// meldet Spieler-Aktionen per notify(), und erst die zur aktuellen Stufe
// passende Aktion schaltet weiter - so lernt man die Steuerung in der
// Reihenfolge, in der man sie braucht. "Erledigt" (abgeschlossen oder
// uebersprungen) merkt sich der Browser pro Geraet, wie die Settings.

const GREEN = '#33ff33';
const MONO = '"Courier New", Courier, monospace';
const STORAGE_KEY = 'bbt-tutorial-done';

export type TutorialTrigger =
  | 'cameraMoved'
  | 'unitSelected'
  | 'moveOrdered'
  | 'attackOrdered'
  | 'terminalOpened';

interface TutorialStep {
  /** null = letzter Schritt, wird per Button statt Aktion abgeschlossen. */
  trigger: TutorialTrigger | null;
  text: string;
}

const STEPS: TutorialStep[] = [
  {
    trigger: 'cameraMoved',
    text: 'Bewege die Kamera: Karte mit Maus/Finger ziehen oder WASD (Q/E dreht, R/F neigt, Mausrad zoomt).',
  },
  {
    trigger: 'unitSelected',
    text: 'Waehle eine Einheit aus: Klicke auf eine deiner (gruenen) Einheiten.',
  },
  {
    trigger: 'moveOrdered',
    text: 'Gib einen Marschbefehl: Klicke auf den Boden - die ausgewaehlte Einheit laeuft dorthin.',
  },
  {
    trigger: 'attackOrdered',
    text: 'Greif an: Klicke auf eine rote Feindeinheit. Tipp: Die Minimap unten rechts zeigt ferne Kontakte als gelbe Punkte.',
  },
  {
    trigger: 'terminalOpened',
    text: 'Oeffne das Terminal mit dem ">_"-Button am linken Rand - dort laufen alle Ereignisse ein, "objective" zeigt dein Missionsziel.',
  },
  {
    trigger: null,
    text: 'Das war die Einfuehrung! Erfuelle jetzt dein Missionsziel: Zerstoere alle Feindeinheiten.',
  },
];

export interface Tutorial {
  /** Zeigt das Tutorial, falls es auf diesem Geraet noch nie beendet wurde. */
  start(): void;
  /** Blendet aus, ohne es als erledigt zu merken (Kartenwechsel/Abbruch). */
  stop(): void;
  /** Missionsende: Sieg gilt als bestanden, Niederlage darf es erneut zeigen. */
  onMissionEnd(outcome: 'won' | 'lost'): void;
  notify(trigger: TutorialTrigger): void;
}

function isDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Ohne localStorage (Private Mode) erscheint das Tutorial eben erneut.
  }
}

export function createTutorial(parent: HTMLElement): Tutorial {
  let active = false;
  let stepIndex = 0;

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    left: '50%',
    bottom: '18px',
    transform: 'translateX(-50%)',
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
    width: 'min(560px, calc(100vw - 120px))',
    padding: '12px 16px',
    background: 'rgba(5, 10, 5, 0.92)',
    border: '1px solid rgba(51, 255, 51, 0.55)',
    borderRadius: '8px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 14px rgba(51, 255, 51, 0.2)',
    color: GREEN,
    fontFamily: MONO,
    fontSize: '14px',
    lineHeight: '1.45',
    textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    // Unter dem Startscreen (20), ueber Canvas und Terminal-Fenster (10).
    zIndex: '15',
  } satisfies Partial<CSSStyleDeclaration>);

  const heading = document.createElement('div');
  Object.assign(heading.style, {
    fontSize: '11px',
    letterSpacing: '2px',
    opacity: '0.6',
  } satisfies Partial<CSSStyleDeclaration>);

  const text = document.createElement('div');

  const buttonRow = document.createElement('div');
  Object.assign(buttonRow.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  } satisfies Partial<CSSStyleDeclaration>);

  function smallButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    Object.assign(button.style, {
      background: 'rgba(51, 255, 51, 0.08)',
      border: '1px solid rgba(51, 255, 51, 0.45)',
      borderRadius: '5px',
      color: GREEN,
      fontFamily: MONO,
      fontSize: '12px',
      padding: '4px 10px',
      cursor: 'pointer',
      textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    } satisfies Partial<CSSStyleDeclaration>);
    return button;
  }

  const doneButton = smallButton('[ VERSTANDEN ]');
  doneButton.addEventListener('click', () => complete());

  const skipButton = smallButton('[ TUTORIAL UEBERSPRINGEN ]');
  skipButton.addEventListener('click', () => complete());

  buttonRow.appendChild(doneButton);
  buttonRow.appendChild(skipButton);

  panel.appendChild(heading);
  panel.appendChild(text);
  panel.appendChild(buttonRow);
  parent.appendChild(panel);

  function renderStep(): void {
    const step = STEPS[stepIndex] as TutorialStep;
    heading.textContent = `TUTORIAL - SCHRITT ${stepIndex + 1}/${STEPS.length}`;
    text.textContent = step.text;
    // Auf dem Schlussschritt gibt es nichts mehr zu ueberspringen.
    doneButton.style.display = step.trigger === null ? 'inline-block' : 'none';
    skipButton.style.display = step.trigger === null ? 'none' : 'inline-block';
  }

  function complete(): void {
    markDone();
    active = false;
    panel.style.display = 'none';
  }

  function start(): void {
    if (isDone()) return;
    active = true;
    stepIndex = 0;
    renderStep();
    panel.style.display = 'flex';
  }

  function stop(): void {
    active = false;
    panel.style.display = 'none';
  }

  function onMissionEnd(outcome: 'won' | 'lost'): void {
    if (!active) return;
    // Wer die Tutorial-Mission gewinnt, braucht die Einfuehrung nicht erneut.
    if (outcome === 'won') markDone();
    stop();
  }

  function notify(trigger: TutorialTrigger): void {
    if (!active) return;
    if ((STEPS[stepIndex] as TutorialStep).trigger !== trigger) return;
    stepIndex += 1;
    renderStep();
  }

  return { start, stop, onMissionEnd, notify };
}
