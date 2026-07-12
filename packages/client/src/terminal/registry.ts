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

interface RegisteredCommand {
  description: string;
  handler: CommandHandler;
}

const registry = new Map<string, RegisteredCommand>();

export function registerCommand(name: string, description: string, handler: CommandHandler): void {
  registry.set(name, { description, handler });
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

// Fuehrt eine eingegebene Zeile aus: erstes Wort = Befehl, Rest = Argumente.
// Gibt den Ausgabetext zurueck (leer = keine Ausgabe). Handler-Fehler werden
// abgefangen, damit ein kaputter Befehl nicht das ganze Terminal lahmlegt.
export async function executeLine(line: string, ctx: TerminalContext): Promise<string> {
  if (lineInterceptor) {
    const interceptor = lineInterceptor;
    try {
      return await interceptor(line, ctx);
    } catch (err) {
      // Ein kaputter Interceptor darf das Terminal nicht dauerhaft
      // "verschlucken" - Modus beenden und normal weitermachen.
      clearLineInterceptor();
      return `Fehler in der Eingabe-Verarbeitung: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const tokens = line.trim().split(/\s+/);
  const name = tokens[0]?.toLowerCase();
  if (!name) return '';

  const command = registry.get(name);
  if (!command) return `Unbekannter Befehl: "${name}" - 'help' zeigt alle Befehle.`;

  try {
    return await command.handler(tokens.slice(1), ctx);
  } catch (err) {
    return `Fehler in Befehl "${name}": ${err instanceof Error ? err.message : String(err)}`;
  }
}
