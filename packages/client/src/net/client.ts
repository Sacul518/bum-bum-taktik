import { decodeServerMessage, type ClientCommand, type ServerMessage } from '@bum-bum-taktik/shared';

export interface ServerConnectionHandlers {
  onMessage: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

// Duenner WebSocket-Client: verbindet, typisiert eingehende Nachrichten,
// reicht sie unveraendert weiter. Keine Interpretation der Inhalte hier.
export function connectToServer(url: string, handlers: ServerConnectionHandlers): WebSocket {
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => handlers.onOpen?.());
  socket.addEventListener('close', () => handlers.onClose?.());
  socket.addEventListener('message', (event) => {
    handlers.onMessage(decodeServerMessage(event.data as string));
  });

  return socket;
}

export function sendCommand(socket: WebSocket, command: ClientCommand): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(command));
}
