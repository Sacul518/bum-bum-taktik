import { executeLine } from './registry.js';

// In-Game-Terminal (docs/KONZEPT.md Abschnitt 6): schwebendes Fenster im
// macOS/Windows-Stil - Titelleiste zum Verschieben, roter Punkt zum
// Schliessen, Groesse aenderbar ueber die Ecke unten rechts (CSS resize).
// Dazu ein fester Seiten-Button am linken Rand mit Terminal-Logo (">_",
// angelehnt ans macOS-Terminal-Icon), der das Fenster ein-/ausblendet.
// Innen bewusst 90er-Retro: gruener Monospace-Text auf schwarzem Grund mit
// leichtem Glow und Scanlines.
//
// Fokus-Regel (Abschnitt 5.2): solange das Eingabefeld den Fokus hat, duerfen
// Tastatur-Events NICHT als Spiel-Hotkeys interpretiert werden - main.ts
// prueft dafuer hasFocus().

const GREEN = '#33ff33';
const MONO = '"Courier New", Courier, monospace';

export interface Terminal {
  open(): void;
  close(): void;
  toggle(): void;
  print(text: string): void;
  hasFocus(): boolean;
  isOpen(): boolean;
}

export function createTerminal(parent: HTMLElement): Terminal {
  // --- Fenster ---
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    left: '84px',
    top: '80px',
    width: 'min(620px, calc(100vw - 100px))',
    height: 'min(420px, calc(100vh - 120px))',
    minWidth: '320px',
    minHeight: '200px',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(5, 10, 5, 0.92)',
    border: '1px solid rgba(51, 255, 51, 0.55)',
    borderRadius: '8px',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55), 0 0 18px rgba(51, 255, 51, 0.25)',
    color: GREEN,
    fontFamily: MONO,
    fontSize: '15px',
    lineHeight: '1.4',
    textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    zIndex: '10',
    // CSS-Resize braucht overflow != visible; hidden clippt zugleich die
    // Scanlines an den abgerundeten Ecken.
    resize: 'both',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);

  // --- Titelleiste: Ziehen verschiebt das Fenster, roter Punkt schliesst ---
  const titleBar = document.createElement('div');
  Object.assign(titleBar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    background: 'rgba(51, 255, 51, 0.08)',
    borderBottom: '1px solid rgba(51, 255, 51, 0.35)',
    cursor: 'move',
    userSelect: 'none',
    // Ohne touchAction none wuerde das Ziehen auf dem iPad als Scroll-Geste
    // interpretiert statt als Fenster-Verschieben.
    touchAction: 'none',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const closeDot = document.createElement('button');
  closeDot.title = 'Terminal schliessen';
  Object.assign(closeDot.style, {
    width: '13px',
    height: '13px',
    borderRadius: '50%',
    background: '#ff5f57',
    border: '1px solid rgba(0, 0, 0, 0.35)',
    padding: '0',
    cursor: 'pointer',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement('span');
  title.textContent = 'Terminal';
  Object.assign(title.style, {
    fontSize: '13px',
    opacity: '0.85',
  } satisfies Partial<CSSStyleDeclaration>);

  titleBar.appendChild(closeDot);
  titleBar.appendChild(title);
  root.appendChild(titleBar);

  // Scanline-Overlay ueber dem ganzen Fenster - reine Optik, laesst
  // Zeigerereignisse durch (pointerEvents none).
  const scanlines = document.createElement('div');
  Object.assign(scanlines.style, {
    position: 'absolute',
    inset: '0',
    background: 'repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.25) 0px, rgba(0, 0, 0, 0.25) 1px, transparent 1px, transparent 3px)',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(scanlines);

  const scrollback = document.createElement('div');
  Object.assign(scrollback.style, {
    flex: '1',
    overflowY: 'auto',
    padding: '10px 12px 4px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(scrollback);

  const inputRow = document.createElement('div');
  Object.assign(inputRow.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px 10px',
    gap: '8px',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const prompt = document.createElement('span');
  prompt.textContent = '>';
  const input = document.createElement('input');
  input.type = 'text';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  Object.assign(input.style, {
    flex: '1',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: GREEN,
    caretColor: GREEN,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    textShadow: 'inherit',
  } satisfies Partial<CSSStyleDeclaration>);

  inputRow.appendChild(prompt);
  inputRow.appendChild(input);
  root.appendChild(inputRow);
  parent.appendChild(root);

  // --- Seiten-Button: Terminal-Logo ">_" am linken Bildschirmrand ---
  const toggleButton = document.createElement('button');
  toggleButton.title = 'Terminal ein-/ausblenden';
  toggleButton.textContent = '>_';
  Object.assign(toggleButton.style, {
    position: 'fixed',
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '52px',
    height: '52px',
    borderRadius: '12px',
    background: 'linear-gradient(#2b2f33, #17191c)',
    border: '1px solid #4a5056',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
    color: GREEN,
    fontFamily: MONO,
    fontSize: '19px',
    fontWeight: 'bold',
    textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    cursor: 'pointer',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);
  parent.appendChild(toggleButton);

  // --- Fenster verschieben (Pointer Capture: Ziehen laeuft auch weiter,
  // wenn der Zeiger kurz das Titelleisten-Element verlaesst) ---
  let dragOffset: { dx: number; dy: number } | null = null;

  titleBar.addEventListener('pointerdown', (event) => {
    if (event.target === closeDot) return;
    titleBar.setPointerCapture(event.pointerId);
    const rect = root.getBoundingClientRect();
    dragOffset = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
  });

  titleBar.addEventListener('pointermove', (event) => {
    if (!dragOffset) return;
    const rect = root.getBoundingClientRect();
    // Klemmen, damit die Titelleiste immer erreichbar bleibt - ein komplett
    // aus dem Bild geschobenes Fenster koennte man nie wieder greifen.
    const x = Math.min(Math.max(event.clientX - dragOffset.dx, 60 - rect.width), window.innerWidth - 60);
    const y = Math.min(Math.max(event.clientY - dragOffset.dy, 0), window.innerHeight - 40);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  });

  const stopDrag = (): void => {
    dragOffset = null;
  };
  titleBar.addEventListener('pointerup', stopDrag);
  titleBar.addEventListener('pointercancel', stopDrag);

  function print(text: string): void {
    for (const lineText of text.split('\n')) {
      const line = document.createElement('div');
      line.textContent = lineText === '' ? ' ' : lineText;
      scrollback.appendChild(line);
    }
    scrollback.scrollTop = scrollback.scrollHeight;
  }

  function clear(): void {
    scrollback.replaceChildren();
  }

  function open(): void {
    root.style.display = 'flex';
    input.focus();
  }

  function close(): void {
    root.style.display = 'none';
    input.blur();
  }

  function isOpen(): boolean {
    return root.style.display !== 'none';
  }

  function toggle(): void {
    if (isOpen()) close();
    else open();
  }

  closeDot.addEventListener('click', close);
  toggleButton.addEventListener('click', () => {
    toggle();
    // Fokus wieder abgeben, sonst wuerde die Leertaste spaeter den Button
    // erneut "klicken" statt als Spiel-Eingabe zu wirken.
    toggleButton.blur();
  });

  async function submit(): Promise<void> {
    const line = input.value;
    input.value = '';
    print(`> ${line}`);
    const output = await executeLine(line, { print, clear, close });
    if (output) print(output);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });

  // Tastatur-Toggle zusaetzlich zum Button. Die physische Taste links neben
  // der 1 meldet als KeyboardEvent.code je nach Tastatur unterschiedlich:
  // "Backquote" auf ANSI-Layouts, aber "IntlBackslash" auf ISO-Layouts
  // (deutsche Mac-Tastatur!) wegen eines bekannten Chromium-Tauschs der
  // beiden Codes - deshalb beide akzeptieren. Escape schliesst zusaetzlich.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Backquote' || event.code === 'IntlBackslash') {
      event.preventDefault();
      toggle();
    } else if (event.key === 'Escape' && isOpen()) {
      close();
    }
  });

  // Klick/Tipp ausserhalb des Fensters gibt den Fokus frei - wie bei einem
  // echten Fenster. Noetig, weil der Canvas-Handler in main.ts per
  // preventDefault() den Standard-Fokuswechsel des Browsers unterdrueckt:
  // ohne diesen Listener blieben alle Tasten Terminal-Eingabe, und die
  // WASD-Kamera ginge nach einem Klick auf die Karte nicht.
  window.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (root.contains(target) || toggleButton.contains(target)) return;
    input.blur();
  });

  // Klick irgendwo ins Terminal fokussiert das Eingabefeld - wie bei einem
  // echten Terminalfenster. Bewusst auf 'click' statt 'pointerdown': nach
  // pointerdown verschiebt der Browser den Fokus per Default wieder auf das
  // geklickte Element, ein frueher focus()-Aufruf ging dadurch sofort
  // verloren (man musste exakt die Eingabezeile treffen). Bei aktiver
  // Textauswahl (Kopieren aus dem Scrollback) wird nicht fokussiert, sonst
  // waere die Auswahl mit dem Loslassen sofort wieder weg.
  root.addEventListener('click', () => {
    if (!isOpen()) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    input.focus();
  });

  return {
    open,
    close,
    toggle,
    print,
    isOpen,
    hasFocus: () => document.activeElement === input,
  };
}
