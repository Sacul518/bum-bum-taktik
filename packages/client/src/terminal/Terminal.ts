import { executeLine } from './registry.js';

// In-Game-Terminal (docs/KONZEPT.md Abschnitt 6): schlankes Scrollback-<div>
// + <input>, kein xterm.js. Optik bewusst 90er-Retro: gruener Monospace-Text
// auf schwarzem Grund mit leichtem Glow und Scanlines.
//
// Fokus-Regel (Abschnitt 5.2): solange das Eingabefeld den Fokus hat, duerfen
// Tastatur-Events NICHT als Spiel-Hotkeys interpretiert werden - main.ts
// prueft dafuer hasFocus().

const GREEN = '#33ff33';

export interface Terminal {
  open(): void;
  close(): void;
  toggle(): void;
  print(text: string): void;
  hasFocus(): boolean;
  isOpen(): boolean;
}

export function createTerminal(parent: HTMLElement): Terminal {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    height: '45%',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(0, 0, 0, 0.88)',
    borderBottom: `2px solid ${GREEN}`,
    boxShadow: `0 0 18px rgba(51, 255, 51, 0.25)`,
    color: GREEN,
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '15px',
    lineHeight: '1.4',
    textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);

  // Scanline-Overlay ueber dem ganzen Terminal - reine Optik, laesst
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

  function print(text: string): void {
    for (const lineText of text.split('\n')) {
      const line = document.createElement('div');
      line.textContent = lineText === '' ? ' ' : lineText;
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

  async function submit(): Promise<void> {
    const line = input.value;
    input.value = '';
    print(`> ${line}`);
    const output = await executeLine(line, { print, clear });
    if (output) print(output);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });

  // Toggle auf KeyboardEvent.code statt event.key: die physische Taste links
  // neben der 1 heisst auf jedem Layout "Backquote" - auf deutschen
  // Tastaturen liegt dort "^", ein Dead Key, der als event.key nur "Dead"
  // meldet und nie ein "`" liefert. Escape schliesst zusaetzlich.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Backquote') {
      event.preventDefault();
      toggle();
    } else if (event.key === 'Escape' && isOpen()) {
      close();
    }
  });

  // Klick irgendwo ins Terminal fokussiert das Eingabefeld - wie bei einem
  // echten Terminalfenster, und auf dem iPad die einzige Moeglichkeit ohne
  // Hardware-Tastatur.
  root.addEventListener('pointerdown', () => {
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
