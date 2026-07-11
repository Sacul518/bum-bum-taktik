// Befehls-Registry fuer das In-Game-Terminal (docs/KONZEPT.md Abschnitt 6):
// neue Befehle registrieren sich selbst ueber registerCommand(), ohne dass
// dafuer diese Datei oder das Widget angefasst werden muss.

export interface TerminalContext {
  print: (text: string) => void;
  clear: () => void;
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

// Fuehrt eine eingegebene Zeile aus: erstes Wort = Befehl, Rest = Argumente.
// Gibt den Ausgabetext zurueck (leer = keine Ausgabe). Handler-Fehler werden
// abgefangen, damit ein kaputter Befehl nicht das ganze Terminal lahmlegt.
export async function executeLine(line: string, ctx: TerminalContext): Promise<string> {
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
