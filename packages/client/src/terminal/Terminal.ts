import {
  commonPrefix,
  completeLine,
  executeLine,
  hasLineInterceptor,
  isKnownCommand,
  type ExecError,
} from './registry.js';

// In-Game-Terminal (docs/KONZEPT.md Abschnitt 6): schwebendes Fenster im
// macOS/Windows-Stil - Titelleiste zum Verschieben, roter Punkt zum
// Schliessen, Groesse aenderbar ueber die Ecke unten rechts (CSS resize).
// Dazu ein fester Seiten-Button am linken Rand mit Terminal-Logo (">_",
// angelehnt ans macOS-Terminal-Icon), der das Fenster ein-/ausblendet.
// Innen bewusst 90er-Retro: gruener Monospace-Text auf schwarzem Grund mit
// leichtem Glow und Scanlines.
//
// Bedienkomfort im ZSH-Stil:
// - Ghost-Vorschlag (gedimmt hinter der Eingabe) aus History oder
//   Vervollstaendigung; Uebernahme mit Pfeil-rechts am Zeilenende.
// - Tab vervollstaendigt Befehle und Argumente (Registry-Completer); bei
//   mehreren Kandidaten erst gemeinsamer Prefix, dann Kandidatenliste.
// - Pfeil-hoch/-runter blaettert durch die Befehls-History.
// - "Error Lens": ungueltige Befehlsworte werden schon beim Tippen rot
//   eingefaerbt; nach dem Absenden wird das fehlerhafte Token rot
//   unterkringelt und die Fehlermeldung direkt darunter angezeigt.
//
// Fokus-Regel (Abschnitt 5.2): solange das Eingabefeld den Fokus hat, duerfen
// Tastatur-Events NICHT als Spiel-Hotkeys interpretiert werden - main.ts
// prueft dafuer hasFocus().

const GREEN = '#33ff33';
const ERROR_RED = '#ff6b5f';
const MONO = '"Courier New", Courier, monospace';
const HISTORY_LIMIT = 100;

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
    // Startet unsichtbar - sichtbar wird das Fenster erst per open()
    // (">_"-Button), beim Spielstart liegt stattdessen der Startscreen oben.
    display: 'none',
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

  // Eingabe mit Spiegel-Overlay: Der sichtbare Text kommt aus dem "mirror"
  // (erlaubt Einfaerbung einzelner Woerter + gedimmten Ghost-Vorschlag), das
  // echte <input> darueber ist transparent und liefert nur Caret, Fokus und
  // Tastatur-Verhalten. Beide teilen sich exakt dieselben Schriftmetriken
  // (Monospace, geerbte Groesse), sonst laege der Caret neben den Zeichen.
  const inputWrap = document.createElement('div');
  Object.assign(inputWrap.style, {
    position: 'relative',
    flex: '1',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);

  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'absolute',
    inset: '0',
    whiteSpace: 'pre',
    overflow: 'hidden',
    pointerEvents: 'none',
    color: GREEN,
  } satisfies Partial<CSSStyleDeclaration>);

  const input = document.createElement('input');
  input.type = 'text';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  Object.assign(input.style, {
    position: 'relative',
    width: '100%',
    padding: '0',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'transparent',
    caretColor: GREEN,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    textShadow: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  inputWrap.appendChild(mirror);
  inputWrap.appendChild(input);
  inputRow.appendChild(prompt);
  inputRow.appendChild(inputWrap);
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

  // Echo der Eingabezeile ("> befehl") als eigenes Element, damit es bei
  // einem Fehler nachtraeglich dekoriert werden kann (Unterkringelung).
  function printEchoRow(line: string): HTMLDivElement {
    const row = document.createElement('div');
    row.textContent = `> ${line}`;
    scrollback.appendChild(row);
    scrollback.scrollTop = scrollback.scrollHeight;
    return row;
  }

  // Error Lens, Teil 1: das fehlerhafte Token in der Echo-Zeile rot
  // unterkringeln (wie in einem Editor).
  function decorateEchoRow(row: HTMLDivElement, line: string, error: ExecError): void {
    row.replaceChildren();
    row.appendChild(document.createTextNode(`> ${line.slice(0, error.tokenStart)}`));
    const bad = document.createElement('span');
    bad.textContent = line.slice(error.tokenStart, error.tokenEnd);
    Object.assign(bad.style, {
      color: ERROR_RED,
      textDecorationLine: 'underline',
      textDecorationStyle: 'wavy',
      textDecorationColor: ERROR_RED,
      textUnderlineOffset: '3px',
      textShadow: '0 0 4px rgba(255, 107, 95, 0.6)',
    } satisfies Partial<CSSStyleDeclaration>);
    row.appendChild(bad);
    row.appendChild(document.createTextNode(line.slice(error.tokenEnd)));
  }

  // Error Lens, Teil 2: Zeigerzeile (^^^^ unter dem Token, "> " = 2 Zeichen
  // Versatz) plus Fehlermeldung, beides rot.
  function printErrorLens(error: ExecError): void {
    const pointer = ' '.repeat(2 + error.tokenStart) + '^'.repeat(Math.max(1, error.tokenEnd - error.tokenStart));
    const row = document.createElement('div');
    row.textContent = `${pointer} ${error.message}`;
    Object.assign(row.style, {
      color: ERROR_RED,
      textShadow: '0 0 4px rgba(255, 107, 95, 0.6)',
    } satisfies Partial<CSSStyleDeclaration>);
    scrollback.appendChild(row);
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

  // --- History (Pfeil hoch/runter, ZSH-artig) ---
  const history: string[] = [];
  let historyIndex = -1; // -1 = frische Eingabe (keine History-Navigation aktiv)
  let draft = ''; // gemerkte frische Eingabe, zu der Pfeil-runter zurueckkehrt

  function navigateHistory(direction: -1 | 1): void {
    if (hasLineInterceptor() || history.length === 0) return;
    if (historyIndex === -1) {
      if (direction === 1) return;
      draft = input.value;
      historyIndex = history.length;
    }
    historyIndex += direction;
    if (historyIndex >= history.length) {
      historyIndex = -1;
      input.value = draft;
    } else {
      historyIndex = Math.max(0, historyIndex);
      input.value = history[historyIndex] as string;
    }
    input.setSelectionRange(input.value.length, input.value.length);
    refreshMirror();
  }

  // --- Ghost-Vorschlag + Live-Einfaerbung (Spiegel-Overlay) ---

  // Juengster History-Eintrag mit passendem Prefix (wie zsh-autosuggestions),
  // sonst Vervollstaendigung des aktuellen Worts.
  function computeSuggestion(): string | null {
    if (hasLineInterceptor()) return null;
    const value = input.value;
    if (!value) return null;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i] as string;
      if (entry.startsWith(value) && entry !== value) return entry;
    }
    const { candidates, wordStart } = completeLine(value);
    if (candidates.length > 0) {
      const completed = value.slice(0, wordStart) + (candidates[0] as string);
      if (completed !== value && completed.startsWith(value)) return completed;
    }
    return null;
  }

  function coloredSpan(text: string, color: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = color;
    if (color === ERROR_RED) span.style.textShadow = '0 0 4px rgba(255, 107, 95, 0.6)';
    return span;
  }

  // Baut den sichtbaren Eingabetext neu auf: Befehlswort gruen (gueltig oder
  // noch gueltiger Anfang) bzw. rot (kein Befehl beginnt so - Live-Error-Lens),
  // Argumente neutral, dahinter der gedimmte Ghost-Vorschlag.
  function refreshMirror(): void {
    const value = input.value;
    mirror.replaceChildren();

    if (value) {
      const match = /^(\s*)(\S+)([\s\S]*)$/.exec(value);
      if (match && !hasLineInterceptor()) {
        const lead = match[1] as string;
        const word = match[2] as string;
        const rest = match[3] as string;
        const wordDone = rest.length > 0; // hinter dem Befehlswort steht schon etwas
        const known = isKnownCommand(word);
        const prefixOk = completeLine(word).candidates.length > 0;
        const invalid = wordDone ? !known : !known && !prefixOk;
        if (lead) mirror.appendChild(document.createTextNode(lead));
        mirror.appendChild(coloredSpan(word, invalid ? ERROR_RED : GREEN));
        if (rest) mirror.appendChild(document.createTextNode(rest));
      } else {
        mirror.appendChild(document.createTextNode(value));
      }
    }

    const suggestion = computeSuggestion();
    if (suggestion) {
      const ghost = document.createElement('span');
      ghost.textContent = suggestion.slice(input.value.length);
      ghost.style.opacity = '0.4';
      mirror.appendChild(ghost);
    }

    // Wenn der Text breiter als das Feld ist, scrollt das Input intern -
    // der Spiegel muss exakt mitscrollen, sonst verrutschen die Zeichen.
    mirror.scrollLeft = input.scrollLeft;
  }

  // --- Tab-Vervollstaendigung (ZSH-artig) ---
  function handleTab(): void {
    if (hasLineInterceptor()) return;
    const value = input.value;
    const { candidates, wordStart } = completeLine(value);
    if (candidates.length === 0) return;

    if (candidates.length === 1) {
      // Eindeutig: Wort ersetzen und Leerzeichen anhaengen (naechstes Argument).
      input.value = `${value.slice(0, wordStart)}${candidates[0] as string} `;
    } else {
      const prefix = commonPrefix(candidates);
      if (prefix.length > value.length - wordStart) {
        input.value = value.slice(0, wordStart) + prefix;
      } else {
        // Wie zsh: alle Kandidaten anzeigen, Eingabe unveraendert lassen.
        print(candidates.join('   '));
      }
    }
    input.setSelectionRange(input.value.length, input.value.length);
    refreshMirror();
  }

  async function submit(): Promise<void> {
    const line = input.value;
    const wasInterceptorInput = hasLineInterceptor();
    input.value = '';
    historyIndex = -1;
    draft = '';
    refreshMirror();

    // Hack-Code-Eingaben u. ae. gehoeren nicht in die History.
    if (!wasInterceptorInput) {
      const trimmed = line.trim();
      if (trimmed && history[history.length - 1] !== trimmed) {
        history.push(trimmed);
        if (history.length > HISTORY_LIMIT) history.shift();
      }
    }

    const echoRow = printEchoRow(line);
    const result = await executeLine(line, { print, clear, close });
    if (result.error) {
      decorateEchoRow(echoRow, line, result.error);
      printErrorLens(result.error);
    }
    if (result.text) print(result.text);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Tab') {
      // Tab darf den Browser-Fokus nicht aus dem Terminal ziehen.
      event.preventDefault();
      handleTab();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateHistory(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateHistory(1);
    } else if (event.key === 'ArrowRight' || event.key === 'End') {
      // Ghost-Vorschlag uebernehmen - aber nur, wenn der Caret schon am
      // Zeilenende steht (sonst ist Pfeil-rechts normale Cursorbewegung).
      const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      const suggestion = atEnd ? computeSuggestion() : null;
      if (suggestion) {
        event.preventDefault();
        input.value = suggestion;
        input.setSelectionRange(input.value.length, input.value.length);
        refreshMirror();
      }
    }
  });

  input.addEventListener('input', refreshMirror);
  // Scroll-Position des Inputs kann sich auch ohne input-Event aendern
  // (Caret-Bewegung per Maus/Tastatur ans Zeilenende).
  input.addEventListener('scroll', () => {
    mirror.scrollLeft = input.scrollLeft;
  });
  input.addEventListener('click', refreshMirror);
  input.addEventListener('keyup', () => {
    mirror.scrollLeft = input.scrollLeft;
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
