import { registerCommand } from '../registry.js';

registerCommand('clear', 'Leert das Terminal.', (_args, ctx) => {
  ctx.clear();
  return '';
});
