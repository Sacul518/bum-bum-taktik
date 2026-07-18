import type { ResourceAmount } from '@bum-bum-taktik/shared';

// Ressourcen-HUD (PLAN.md Session B): schlichte Anzeige oben rechts im
// Terminal-Look (gleiche Farbwelt wie Minimap/Terminal). Bewusst nur Text -
// das kompakte HUD-Einheiten-Panel kommt erst in Session C.

export interface ResourceHud {
  update(resources: ResourceAmount): void;
  dispose(): void;
}

export function createResourceHud(parent: HTMLElement): ResourceHud {
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'fixed',
    right: '16px',
    top: '16px',
    padding: '6px 12px',
    background: 'rgba(5, 10, 5, 0.85)',
    border: '1px solid rgba(51, 255, 51, 0.55)',
    borderRadius: '6px',
    boxShadow: '0 0 12px rgba(51, 255, 51, 0.25)',
    color: '#33ff33',
    font: '14px/1.4 "SF Mono", Menlo, Consolas, monospace',
    whiteSpace: 'pre',
    zIndex: '5',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  element.textContent = '$ 0    # 0';
  parent.appendChild(element);

  function update(resources: ResourceAmount): void {
    // "$" = Credits, "#" = Material - kurze ASCII-Symbole statt Emoji,
    // passend zur Retro-Terminal-Optik.
    element.textContent = `$ ${resources.credits}    # ${resources.material}`;
  }

  function dispose(): void {
    element.remove();
  }

  return { update, dispose };
}
