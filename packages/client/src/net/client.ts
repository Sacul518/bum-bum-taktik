import { decodeServerMessage, type ClientCommand, type ServerMessage } from '@bum-bum-taktik/shared';

export interface ServerConnectionHandlers {
  onMessage: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Dauerhafte Verbindung mit Auto-Reconnect; send() verwirft Befehle, solange getrennt. */
export interface ServerConnection {
  send(command: ClientCommand): void;
}

// Auto-Reconnect mit Backoff: der Server startet im Dev-Betrieb bei jedem
// Build neu (node --watch), und auf dem iPad kann Ruhezustand/WLAN-Wechsel
// die Verbindung trennen (docs/KONZEPT.md Abschnitt 10). Wiederverbinden ist
// hier trivial korrekt, weil der Server nach JEDEM Verbindungsaufbau ein
// vollstaendiges hello schickt und der Client jedes hello als kompletten
// Welt-Neuaufbau behandelt.
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 5000;

// Duenner WebSocket-Client: verbindet (und wiederverbindet), typisiert
// eingehende Nachrichten, reicht sie unveraendert weiter. Keine
// Interpretation der Inhalte hier.
export function connectToServer(url: string, handlers: ServerConnectionHandlers): ServerConnection {
  let socket: WebSocket;
  let retryDelayMs = RECONNECT_MIN_MS;

  function open(): void {
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      retryDelayMs = RECONNECT_MIN_MS;
      handlers.onOpen?.();
    });
    // 'close' feuert auch nach einem fehlgeschlagenen Verbindungsversuch -
    // ein einziger Handler deckt damit Trennung UND erfolglosen Retry ab.
    socket.addEventListener('close', () => {
      handlers.onClose?.();
      setTimeout(open, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, RECONNECT_MAX_MS);
    });
    socket.addEventListener('message', (event) => {
      handlers.onMessage(decodeServerMessage(event.data as string));
    });
  }

  open();

  return {
    send(command: ClientCommand): void {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(command));
      }
    },
  };
}
