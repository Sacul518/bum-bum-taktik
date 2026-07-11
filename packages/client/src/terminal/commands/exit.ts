import { registerCommand } from '../registry.js';

// "exit" schliesst das Terminal-Fenster - wie bei einer echten Shell. Wieder
// oeffnen: ">_"-Button am linken Rand.

registerCommand('exit', 'Schliesst das Terminal-Fenster.', (_args, ctx) => {
  ctx.close();
  return '';
});
