import {
  MAP_PRESETS,
  MISSIONS,
  describeObjective,
  getMission,
  isMissionUnlocked,
  missionsForRegion,
  previousMissionInRegion,
  type MapPresetId,
  type MissionDef,
  type UnitType,
} from '@bum-bum-taktik/shared';
import { getActiveMission, getWonMissions } from '../terminal/gameBridge.js';
import { listCommands } from '../terminal/registry.js';
import { getSettings, updateSettings } from './settings.js';

// Startscreen (PLAN.md Session C): Missions-/Kampagnenwahl als Overlay im
// Terminal-Look, statt dass der Spieler beim Start Terminal-Befehle tippen
// muss. Links die Missionsketten aller Regionen (Reihenfolge wie in
// shared/missions.ts), rechts Briefing + Ziel der ausgewaehlten Mission mit
// Start-Button - das Briefing steht damit VOR dem Start lesbar da, das
// Terminal bleibt Zweitweg und Ereignisprotokoll. Freischalt-/Gewonnen-
// Stati kommen wie beim missions-Befehl aus der gameBridge (der Server
// liefert sie per hello/missionEnd zu, main.ts ruft refresh()).

const GREEN = '#33ff33';
const ERROR_RED = '#ff6b5f';
const MONO = '"Courier New", Courier, monospace';

// Deutsche Anzeigenamen nur fuer den Startscreen - die Terminal-Befehle
// nutzen bewusst weiter die technischen Ids (produce infantry usw.).
const UNIT_NAME: Record<UnitType, string> = {
  infantry: 'Infanterie',
  tank: 'Panzer',
  boat: 'Boot',
  plane: 'Flugzeug',
};

/** Ergebnis-Zeile fuer die Kopfzeile nach einem Missionsende. */
export interface MissionEndStatus {
  text: string;
  tone: 'won' | 'lost';
}

export interface StartScreen {
  open(status?: MissionEndStatus): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Baut Liste + Detail aus den gameBridge-Stati neu (nach jedem hello). */
  refresh(): void;
}

export function createStartScreen(parent: HTMLElement, onStartMission: (missionId: string) => boolean): StartScreen {
  // Regions-Reihenfolge wie das erste Auftreten in MISSIONS (Plains als
  // Einstiegs-Kette zuerst), nicht die Record-Reihenfolge der MAP_PRESETS.
  const regionOrder: MapPresetId[] = [];
  for (const mission of MISSIONS) {
    if (!regionOrder.includes(mission.region)) regionOrder.push(mission.region);
  }

  // Vorausgewaehlt ist die "naechste" Kampagnenmission: die erste noch nicht
  // gewonnene, die schon freigeschaltet ist.
  function defaultSelection(): string {
    const won = getWonMissions();
    const next = MISSIONS.find((mission) => !won.includes(mission.id) && isMissionUnlocked(mission.id, won));
    return (next ?? (MISSIONS[0] as MissionDef)).id;
  }

  let selectedId = defaultSelection();

  // --- Abdunkelnder Hintergrund + Panel ---
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.72)',
    zIndex: '20',
  } satisfies Partial<CSSStyleDeclaration>);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: 'min(860px, calc(100vw - 32px))',
    height: 'min(600px, calc(100vh - 32px))',
    background: 'rgba(5, 10, 5, 0.95)',
    border: '1px solid rgba(51, 255, 51, 0.55)',
    borderRadius: '10px',
    boxShadow: '0 16px 60px rgba(0, 0, 0, 0.6), 0 0 24px rgba(51, 255, 51, 0.25)',
    color: GREEN,
    fontFamily: MONO,
    fontSize: '15px',
    lineHeight: '1.45',
    textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);

  // Scanline-Overlay wie beim Terminal - reine Optik, laesst Klicks durch.
  const scanlines = document.createElement('div');
  Object.assign(scanlines.style, {
    position: 'absolute',
    inset: '0',
    background: 'repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.25) 0px, rgba(0, 0, 0, 0.25) 1px, transparent 1px, transparent 3px)',
    pointerEvents: 'none',
    zIndex: '1',
  } satisfies Partial<CSSStyleDeclaration>);
  panel.appendChild(scanlines);

  // --- Kopfzeile: Titel + optionale Ergebniszeile nach Missionsende ---
  const header = document.createElement('div');
  Object.assign(header.style, {
    padding: '14px 18px 10px',
    borderBottom: '1px solid rgba(51, 255, 51, 0.35)',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'BUM BUM TAKTIK';
  Object.assign(title.style, {
    fontSize: '26px',
    fontWeight: 'bold',
    letterSpacing: '4px',
  } satisfies Partial<CSSStyleDeclaration>);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'KAMPAGNE - waehle deine Mission';
  Object.assign(subtitle.style, {
    fontSize: '13px',
    letterSpacing: '2px',
    opacity: '0.7',
  } satisfies Partial<CSSStyleDeclaration>);

  const statusLine = document.createElement('div');
  Object.assign(statusLine.style, {
    display: 'none',
    marginTop: '6px',
    fontSize: '14px',
  } satisfies Partial<CSSStyleDeclaration>);

  header.appendChild(title);
  header.appendChild(subtitle);
  header.appendChild(statusLine);
  panel.appendChild(header);

  // --- Tab-Leiste: Missionen | Einstellungen | Hilfe (PLAN.md Session C:
  // Settings- und Hilfe-Seite leben als Seiten im selben Overlay) ---
  type PageId = 'missions' | 'settings' | 'help';

  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, {
    display: 'flex',
    borderBottom: '1px solid rgba(51, 255, 51, 0.35)',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  panel.appendChild(tabBar);

  const tabButtons = new Map<PageId, HTMLButtonElement>();
  for (const [page, label] of [
    ['missions', 'MISSIONEN'],
    ['settings', 'EINSTELLUNGEN'],
    ['help', 'HILFE'],
  ] as const) {
    const tab = document.createElement('button');
    tab.textContent = label;
    Object.assign(tab.style, {
      background: 'transparent',
      border: 'none',
      borderRight: '1px solid rgba(51, 255, 51, 0.35)',
      color: GREEN,
      fontFamily: MONO,
      fontSize: '13px',
      letterSpacing: '2px',
      padding: '8px 18px',
      cursor: 'pointer',
      textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    } satisfies Partial<CSSStyleDeclaration>);
    tab.addEventListener('click', () => showPage(page));
    tabButtons.set(page, tab);
    tabBar.appendChild(tab);
  }

  // --- Inhalt: Missionsliste links, Detail rechts ---
  const content = document.createElement('div');
  Object.assign(content.style, {
    display: 'flex',
    flex: '1',
    minHeight: '0',
  } satisfies Partial<CSSStyleDeclaration>);

  const list = document.createElement('div');
  Object.assign(list.style, {
    width: '44%',
    overflowY: 'auto',
    borderRight: '1px solid rgba(51, 255, 51, 0.35)',
    padding: '6px 0 10px',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const detail = document.createElement('div');
  Object.assign(detail.style, {
    flex: '1',
    overflowY: 'auto',
    padding: '14px 18px',
  } satisfies Partial<CSSStyleDeclaration>);

  content.appendChild(list);
  content.appendChild(detail);
  panel.appendChild(content);

  // Einstellungen und Hilfe teilen sich den Platz der Missionsseite -
  // showPage() blendet genau eine der drei um.
  function pageContainer(): HTMLDivElement {
    const page = document.createElement('div');
    Object.assign(page.style, {
      display: 'none',
      flex: '1',
      minHeight: '0',
      overflowY: 'auto',
      padding: '14px 18px',
    } satisfies Partial<CSSStyleDeclaration>);
    panel.appendChild(page);
    return page;
  }
  const settingsPage = pageContainer();
  const helpPage = pageContainer();

  function showPage(page: PageId): void {
    content.style.display = page === 'missions' ? 'flex' : 'none';
    settingsPage.style.display = page === 'settings' ? 'block' : 'none';
    helpPage.style.display = page === 'help' ? 'block' : 'none';
    for (const [id, tab] of tabButtons) {
      tab.style.background = id === page ? 'rgba(51, 255, 51, 0.14)' : 'transparent';
      tab.style.opacity = id === page ? '1' : '0.65';
    }
    if (page === 'settings') renderSettings();
    if (page === 'help') renderHelp();
  }

  // --- Fusszeile: Terminal-Hinweis + Zurueck-Button ---
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 18px',
    borderTop: '1px solid rgba(51, 255, 51, 0.35)',
    flex: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  const hint = document.createElement('div');
  hint.textContent = 'Alles geht auch im Terminal (">_"-Button links): mission list, map select, help.';
  Object.assign(hint.style, {
    fontSize: '12px',
    opacity: '0.6',
  } satisfies Partial<CSSStyleDeclaration>);

  const backButton = textButton('[ ZURUECK ZUM SPIEL ]');
  backButton.addEventListener('click', () => close());

  footer.appendChild(hint);
  footer.appendChild(backButton);
  panel.appendChild(footer);

  root.appendChild(panel);
  parent.appendChild(root);

  // --- Seiten-Button am linken Rand (ueber dem ">_"-Terminal-Button) ---
  const menuButton = document.createElement('button');
  menuButton.title = 'Missionsauswahl ein-/ausblenden';
  menuButton.textContent = '≡';
  Object.assign(menuButton.style, {
    position: 'fixed',
    left: '14px',
    top: 'calc(50% - 64px)',
    transform: 'translateY(-50%)',
    width: '52px',
    height: '52px',
    borderRadius: '12px',
    background: 'linear-gradient(#2b2f33, #17191c)',
    border: '1px solid #4a5056',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
    color: GREEN,
    fontFamily: MONO,
    fontSize: '26px',
    fontWeight: 'bold',
    textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
    cursor: 'pointer',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);
  parent.appendChild(menuButton);

  menuButton.addEventListener('click', () => {
    toggle();
    // Fokus abgeben, sonst wuerde die Leertaste den Button erneut "klicken".
    menuButton.blur();
  });

  function textButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    Object.assign(button.style, {
      background: 'rgba(51, 255, 51, 0.08)',
      border: '1px solid rgba(51, 255, 51, 0.55)',
      borderRadius: '6px',
      color: GREEN,
      fontFamily: MONO,
      fontSize: '14px',
      padding: '8px 14px',
      cursor: 'pointer',
      textShadow: '0 0 4px rgba(51, 255, 51, 0.6)',
      flex: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    return button;
  }

  function renderList(): void {
    list.replaceChildren();
    const won = getWonMissions();
    for (const region of regionOrder) {
      const regionHeader = document.createElement('div');
      regionHeader.textContent = `== ${MAP_PRESETS[region].name.toUpperCase()} ==`;
      Object.assign(regionHeader.style, {
        padding: '10px 16px 4px',
        fontSize: '12px',
        letterSpacing: '2px',
        opacity: '0.6',
      } satisfies Partial<CSSStyleDeclaration>);
      list.appendChild(regionHeader);

      for (const mission of missionsForRegion(region)) {
        const unlocked = isMissionUnlocked(mission.id, won);
        const marker = won.includes(mission.id) ? '[x]' : unlocked ? '[ ]' : '[-]';
        const active = getActiveMission() === mission.id;
        const row = document.createElement('button');
        row.textContent = `${marker} ${mission.name}${active ? ' (aktiv)' : ''}`;
        Object.assign(row.style, {
          display: 'block',
          width: '100%',
          textAlign: 'left',
          padding: '6px 16px',
          background: mission.id === selectedId ? 'rgba(51, 255, 51, 0.14)' : 'transparent',
          border: 'none',
          color: GREEN,
          fontFamily: MONO,
          fontSize: '15px',
          cursor: 'pointer',
          // Gesperrte Missionen bleiben anklickbar (Detail erklaert, was
          // fehlt), sind aber sichtbar gedimmt.
          opacity: unlocked ? '1' : '0.45',
        } satisfies Partial<CSSStyleDeclaration>);
        row.addEventListener('click', () => {
          selectedId = mission.id;
          renderList();
          renderDetail();
        });
        list.appendChild(row);
      }
    }
  }

  function detailLine(text: string, style?: Partial<CSSStyleDeclaration>): void {
    const line = document.createElement('div');
    line.textContent = text;
    if (style) Object.assign(line.style, style);
    detail.appendChild(line);
  }

  function renderDetail(): void {
    detail.replaceChildren();
    const mission = getMission(selectedId);
    if (!mission) return;
    const won = getWonMissions();
    const unlocked = isMissionUnlocked(mission.id, won);
    const active = getActiveMission() === mission.id;

    detailLine(mission.name, { fontSize: '19px', fontWeight: 'bold' });
    detailLine(`Region: ${MAP_PRESETS[mission.region].name}${won.includes(mission.id) ? '  -  bereits gewonnen' : ''}`, {
      fontSize: '13px',
      opacity: '0.7',
      marginBottom: '10px',
    });
    detailLine(mission.description, { opacity: '0.85', marginBottom: '10px' });

    detailLine('BRIEFING', { fontSize: '12px', letterSpacing: '2px', opacity: '0.6' });
    detailLine(mission.briefing, { marginBottom: '10px' });

    detailLine(`Ziel: ${describeObjective(mission.objective)}`);
    const troops = mission.setup
      .filter((entry) => entry.faction === 'player')
      .map((entry) => `${entry.count}x ${UNIT_NAME[entry.unitType]}`)
      .join(', ');
    detailLine(`Deine Truppe: ${troops}`, { marginBottom: '14px' });

    if (!unlocked) {
      const previous = previousMissionInRegion(mission.id);
      detailLine(previous ? `Gesperrt - gewinne zuerst '${previous.name}'.` : 'Gesperrt.', {
        color: ERROR_RED,
        textShadow: '0 0 4px rgba(255, 107, 95, 0.6)',
        marginBottom: '14px',
      });
      return;
    }

    const startButton = textButton(active ? '[ MISSION NEU STARTEN ]' : '[ MISSION STARTEN ]');
    startButton.addEventListener('click', () => {
      // Schliessen erst bei angenommenem Befehl - ohne Serververbindung
      // (sendGameCommand liefert false) bliebe der Screen sonst kommentarlos
      // zu, obwohl nichts gestartet wurde.
      if (onStartMission(mission.id)) close();
    });
    detail.appendChild(startButton);
  }

  function appendLine(target: HTMLElement, text: string, style?: Partial<CSSStyleDeclaration>): void {
    const line = document.createElement('div');
    line.textContent = text;
    if (style) Object.assign(line.style, style);
    target.appendChild(line);
  }

  function sectionHeading(target: HTMLElement, text: string): void {
    appendLine(target, text, { fontSize: '12px', letterSpacing: '2px', opacity: '0.6', marginBottom: '4px' });
  }

  const CAMERA_SPEED_CHOICES = [0.5, 1, 1.5, 2];

  function renderSettings(): void {
    settingsPage.replaceChildren();
    const settings = getSettings();

    sectionHeading(settingsPage, 'EINSTELLUNGEN');
    appendLine(settingsPage, 'Gelten nur fuer dieses Geraet (im Browser gespeichert), wirken sofort.', {
      fontSize: '13px',
      opacity: '0.7',
      marginBottom: '16px',
    });

    appendLine(settingsPage, 'Kamera-Tempo (Schwenken, Drehen, Neigen):', { marginBottom: '6px' });
    const speedRow = document.createElement('div');
    Object.assign(speedRow.style, {
      display: 'flex',
      gap: '10px',
      marginBottom: '18px',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const factor of CAMERA_SPEED_CHOICES) {
      const button = textButton(`[ ${factor}x ]`);
      if (factor === settings.cameraSpeed) button.style.background = 'rgba(51, 255, 51, 0.28)';
      button.addEventListener('click', () => {
        updateSettings({ cameraSpeed: factor });
        renderSettings();
      });
      speedRow.appendChild(button);
    }
    settingsPage.appendChild(speedRow);

    function toggleRow(label: string, value: boolean, onToggle: () => void): void {
      const button = textButton(`[${value ? 'x' : ' '}] ${label}`);
      Object.assign(button.style, {
        display: 'block',
        marginBottom: '12px',
        textAlign: 'left',
      } satisfies Partial<CSSStyleDeclaration>);
      button.addEventListener('click', () => {
        onToggle();
        renderSettings();
      });
      settingsPage.appendChild(button);
    }

    toggleRow('Mausrad-Zoom umkehren', settings.invertZoom, () =>
      updateSettings({ invertZoom: !getSettings().invertZoom }),
    );
    toggleRow('Waelder & Felsen anzeigen (aus = weniger GPU-Last)', settings.showDecoration, () =>
      updateSettings({ showDecoration: !getSettings().showDecoration }),
    );
  }

  function renderHelp(): void {
    // Statischer Inhalt - einmal bauen reicht.
    if (helpPage.childElementCount > 0) return;

    const paragraph = { marginBottom: '14px' } satisfies Partial<CSSStyleDeclaration>;

    sectionHeading(helpPage, 'STEUERUNG (MAUS/TOUCH)');
    appendLine(helpPage, 'Klick auf eigene Einheit: auswaehlen. Klick auf den Boden: Auswahl dorthin bewegen.');
    appendLine(helpPage, 'Klick auf Feind oder feindliches/neutrales Gebaeude: angreifen.');
    appendLine(helpPage, 'Ziehen: Kamera schwenken. Mausrad / Zwei-Finger-Pinch: zoomen.');
    appendLine(helpPage, 'Minimap anklicken/ziehen: Kamera dorthin zentrieren.');
    appendLine(helpPage, 'Nur Infanterie ausgewaehlt + Klick auf eigenes Boot/Flugzeug: einsteigen.', paragraph);

    sectionHeading(helpPage, 'STEUERUNG (TASTATUR)');
    appendLine(helpPage, 'WASD: Kamera schwenken. Q/E: drehen. R/F: neigen. Escape: Fenster schliessen.', paragraph);

    sectionHeading(helpPage, 'SPIELABLAUF');
    appendLine(helpPage, 'Mission waehlen und Ziel im Briefing lesen - "objective" im Terminal zeigt den Fortschritt.');
    appendLine(helpPage, 'Gebaeude einnehmen: Infanterie danebenstellen (dauert ein paar Sekunden; steht auch Feind-Infanterie daneben, pausiert die Einnahme).');
    appendLine(helpPage, 'Wirtschaft: Staedte und HQ liefern laufend Credits, Minen liefern Material.');
    appendLine(helpPage, 'Produktion (kostet Ressourcen): Kaserne baut Infanterie, Fabrik Panzer, Hafen Boote, Flugplatz Flugzeuge.');
    appendLine(helpPage, 'Radar: HQ und eigener Flugplatz melden ferne Feinde als gelbe Blips auf der Minimap.');
    appendLine(helpPage, 'Vorsicht: Wachtuerme an der Feindbasis schiessen auf alles in Reichweite.', paragraph);

    sectionHeading(helpPage, 'TERMINAL-BEFEHLE (">_"-BUTTON AM LINKEN RAND)');
    // Zwei Spalten statt padEnd-Leerzeichen: mit white-space:pre wuerden
    // lange Beschreibungen rechts abgeschnitten, so bricht nur die
    // Beschreibungs-Spalte um und die Befehlsnamen bleiben buendig.
    const commands = listCommands();
    const nameWidth = Math.max(...commands.map((command) => command.name.length));
    for (const command of commands) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        gap: '12px',
        fontSize: '14px',
        marginBottom: '2px',
      } satisfies Partial<CSSStyleDeclaration>);
      const name = document.createElement('span');
      name.textContent = command.name;
      Object.assign(name.style, {
        flex: 'none',
        width: `${nameWidth}ch`,
      } satisfies Partial<CSSStyleDeclaration>);
      const description = document.createElement('span');
      description.textContent = command.description;
      description.style.flex = '1';
      row.appendChild(name);
      row.appendChild(description);
      helpPage.appendChild(row);
    }
  }

  function refresh(): void {
    // Nach einem Sieg auf die naechste freigeschaltete Mission springen -
    // manuell ausgewaehlte (auch gewonnene) Missionen bleiben sonst stehen.
    if (getWonMissions().includes(selectedId)) selectedId = defaultSelection();
    renderList();
    renderDetail();
  }

  function open(status?: MissionEndStatus): void {
    if (status) {
      statusLine.textContent = status.text;
      statusLine.style.display = 'block';
      statusLine.style.color = status.tone === 'won' ? GREEN : ERROR_RED;
      statusLine.style.textShadow =
        status.tone === 'won' ? '0 0 4px rgba(51, 255, 51, 0.6)' : '0 0 4px rgba(255, 107, 95, 0.6)';
    } else {
      statusLine.style.display = 'none';
    }
    // Immer auf der Missionsseite oeffnen - besonders nach missionEnd soll
    // die naechste Mission direkt sichtbar sein, egal welcher Tab zuletzt
    // offen war.
    showPage('missions');
    refresh();
    root.style.display = 'flex';
  }

  function close(): void {
    root.style.display = 'none';
  }

  function isOpen(): boolean {
    return root.style.display !== 'none';
  }

  function toggle(): void {
    if (isOpen()) close();
    else open();
  }

  // Escape schliesst (wie beim Terminal), Klick auf den dunklen Hintergrund
  // ebenfalls - das Spiel laeuft hinter dem Overlay ohnehin weiter.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close();
  });
  root.addEventListener('pointerdown', (event) => {
    if (event.target === root) close();
  });

  showPage('missions');
  refresh();
  return { open, close, toggle, isOpen, refresh };
}
