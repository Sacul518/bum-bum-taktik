import { listCommands, registerCommand } from '../registry.js';

registerCommand('help', 'Zeigt alle verfuegbaren Befehle.', () => {
  const commands = listCommands();
  const width = Math.max(...commands.map((c) => c.name.length));
  return commands.map((c) => `${c.name.padEnd(width + 2)}${c.description}`).join('\n');
});
