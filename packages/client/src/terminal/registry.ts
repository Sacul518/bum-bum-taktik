// Befehls-Registry fuer das In-Game-Terminal (docs/KONZEPT.md Abschnitt 6):
// neue Befehle registrieren sich selbst ueber registerCommand(), ohne dass
// dafuer diese Datei oder das Widget angefasst werden muss.

export interface TerminalContext {
  print: (text: string) => void;
  clear: () => void;
  /** Schliesst das Terminal-Fenster (fuer den exit-Befehl). */
  close: () => void;
}

export type CommandHandler = (args: string[], ctx: TerminalContext) => string | Promise<string>;

// Liefert Vervollstaendigungs-Kandidaten fuer das Argument an Position
// argIndex (0 = erstes Argument nach dem Befehlsnamen). Der Prefix-Filter
// passiert zentral in completeLine() - Completer geben einfach alle
// gueltigen Werte zurueck (z. B. Einheiten-IDs, Missions-IDs).
export type ArgCompleter = (args: string[], argIndex: number) => string[];

interface RegisteredCommand {
  description: string;
  handler: CommandHandler;
  completer?: ArgCompleter;
}

const registry = new Map<string, RegisteredCommand>();

export function registerCommand(name: string, description: string, handler: CommandHandler, completer?: ArgCompleter): void {
  registry.set(name, { description, handler, ...(completer ? { completer } : {}) });
}

/** Fuer die Live-Faerbung des Befehlsworts im Widget (gruen = bekannt). */
export function isKnownCommand(name: string): boolean {
  return registry.has(name.toLowerCase());
}

export function listCommands(): { name: string; description: string }[] {
  return Array.from(registry.entries())
    .map(([name, command]) => ({ name, description: command.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Line-Interceptor (docs/KONZEPT.md Abschnitt 6/9): waehrend eines laufenden
// Minispiels (z. B. Hacking-Code-Eingabe) faengt er die naechste(n)
// Eingabezeile(n) ab, statt sie durch die Befehlssuche zu schicken. Es gibt
// bewusst nur EINEN Slot - zwei gleichzeitige Eingabe-Modi ergeben in einem
// einzigen Terminal keinen Sinn.
export type LineInterceptor = (line: string, ctx: TerminalContext) => string | Promise<string>;

let lineInterceptor: LineInterceptor | null = null;

export function setLineInterceptor(interceptor: LineInterceptor): void {
  lineInterceptor = interceptor;
}

export function clearLineInterceptor(): void {
  lineInterceptor = null;
}

/** Waehrend eines Eingabe-Modus (Hack-Code) sind Autocomplete/History sinnlos. */
export function hasLineInterceptor(): boolean {
  return lineInterceptor !== null;
}

// --- Autocomplete (ZSH-artig, docs/KONZEPT.md Abschnitt 6) ---

export interface CompletionResult {
  /** Alle passenden Kandidaten fuer das angefangene Wort. */
  candidates: string[];
  /** Zeichenposition, an der das zu vervollstaendigende Wort beginnt. */
  wordStart: number;
}

// Kandidaten fuer die aktuelle Eingabe: erstes Wort = Befehlsname aus der
// Registry, weitere Woerter = Completer des Befehls (falls vorhanden).
// "line" ist der Text bis zum Cursor; ein Leerzeichen am Ende beginnt ein
// neues (leeres) Wort.
export function completeLine(line: string): CompletionResult {
  const trailingSpace = /\s$/.test(line);
  const tokens = line.trimStart().split(/\s+/).filter((t) => t.length > 0);
  const wordStart = trailingSpace ? line.length : line.length - (tokens[tokens.length - 1]?.length ?? 0);

  // Noch im Befehlsnamen (erstes Wort, kein Leerzeichen dahinter)?
  if (tokens.length === 0 || (tokens.length === 1 && !trailingSpace)) {
    const prefix = (tokens[0] ?? '').toLowerCase();
    return {
      candidates: Array.from(registry.keys()).filter((name) => name.startsWith(prefix)).sort(),
      wordStart,
    };
  }

  const command = registry.get((tokens[0] as string).toLowerCase());
  if (!command?.completer) return { candidates: [], wordStart };

  const args = tokens.slice(1);
  const argIndex = trailingSpace ? args.length : args.length - 1;
  const prefix = trailingSpace ? '' : (args[args.length - 1] as string).toLowerCase();
  const candidates = command.completer(args, argIndex).filter((c) => c.toLowerCase().startsWith(prefix));
  return { candidates: Array.from(new Set(candidates)).sort(), wordStart };
}

/** Laengster gemeinsamer Prefix - fuer Tab-Vervollstaendigung bei mehreren Kandidaten. */
export function commonPrefix(candidates: string[]): string {
  if (candidates.length === 0) return '';
  let prefix = candidates[0] as string;
  for (const candidate of candidates.slice(1)) {
    while (!candidate.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

// --- Error Lens (Aufgabe "Terminal-Upgrades") ---

export interface ExecError {
  /** Zeichenbereich des fehlerhaften Tokens in der Eingabezeile (fuer die Unterkringelung). */
  tokenStart: number;
  tokenEnd: number;
  /** Fehlertext, wird rot inline unter der Eingabe-Echozeile angezeigt. */
  message: string;
}

export interface ExecResult {
  /** Normale Ausgabe (leer = keine). */
  text: string;
  error?: ExecError;
}

// Levenshtein-Distanz fuer "Meintest du ...?" bei unbekannten Befehlen -
// bewusst die simple O(n*m)-Variante, Befehlsnamen sind kurz.
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[] = Array.from({ length: rows * cols }, () => 0);
  for (let i = 0; i < rows; i++) dist[i * cols] = i;
  for (let j = 0; j < cols; j++) dist[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const substitution = (dist[(i - 1) * cols + (j - 1)] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      dist[i * cols + j] = Math.min((dist[(i - 1) * cols + j] as number) + 1, (dist[i * cols + (j - 1)] as number) + 1, substitution);
    }
  }
  return dist[rows * cols - 1] as number;
}

function suggestCommand(name: string): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const known of registry.keys()) {
    const distance = editDistance(name, known);
    if (distance < bestDistance) {
      best = known;
      bestDistance = distance;
    }
  }
  // Mehr als 2 Tippfehler: kein Vorschlag, sonst kaemen absurde Treffer.
  return bestDistance <= 2 ? best : null;
}

// Fuehrt eine eingegebene Zeile aus: erstes Wort = Befehl, Rest = Argumente.
// Handler-Fehler werden abgefangen, damit ein kaputter Befehl nicht das
// ganze Terminal lahmlegt; unbekannte Befehle und Exceptions kommen als
// strukturierter Fehler zurueck (Error-Lens-Darstellung im Widget).
export async function executeLine(line: string, ctx: TerminalContext): Promise<ExecResult> {
  if (lineInterceptor) {
    const interceptor = lineInterceptor;
    try {
      return { text: await interceptor(line, ctx) };
    } catch (err) {
      // Ein kaputter Interceptor darf das Terminal nicht dauerhaft
      // "verschlucken" - Modus beenden und normal weitermachen.
      clearLineInterceptor();
      return { text: '', error: { tokenStart: 0, tokenEnd: line.length, message: `Fehler in der Eingabe-Verarbeitung: ${err instanceof Error ? err.message : String(err)}` } };
    }
  }

  const tokens = line.trim().split(/\s+/);
  const name = tokens[0]?.toLowerCase();
  if (!name) return { text: '' };

  const tokenStart = line.indexOf(tokens[0] as string);
  const tokenEnd = tokenStart + (tokens[0] as string).length;

  const command = registry.get(name);
  if (!command) {
    const suggestion = suggestCommand(name);
    return {
      text: '',
      error: {
        tokenStart,
        tokenEnd,
        message: `Unbekannter Befehl "${name}"${suggestion ? ` - meintest du "${suggestion}"?` : ''} ('help' zeigt alle Befehle.)`,
      },
    };
  }

  try {
    return { text: await command.handler(tokens.slice(1), ctx) };
  } catch (err) {
    return {
      text: '',
      error: { tokenStart, tokenEnd, message: `Fehler in Befehl "${name}": ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}
