/**
 * Claude may spawn multiple costa-mcp stdio processes (shared-pool / Cowork).
 * Only the primary holds WebSocket :8081; secondaries relay browser requests to it.
 */
import { WebSocket as WsClient, type WebSocket, WebSocketServer } from "ws";

export const RELAY_REGISTER = "costa-mcp-relay-register";
export const RELAY_REGISTER_OK = "costa-mcp-relay-register:ok";
export const RELAY_REQUEST = "costa-mcp-relay-request";
export const RELAY_RESPONSE = "costa-mcp-relay-response";

const relaySockets = new WeakSet<WebSocket>();

export function isRelaySocket(socket: WebSocket): boolean {
  return relaySockets.has(socket);
}

export function attachBridgeRelayServer(
  wss: WebSocketServer,
  forwardToBrowser: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
  log: (msg: string) => void
): void {
  wss.on("connection", (socket) => {
    let role: "pending" | "relay" | "browser" = "pending";

    socket.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;

        if (role === "pending" && msg.type === RELAY_REGISTER) {
          role = "relay";
          relaySockets.add(socket);
          socket.send(JSON.stringify({ type: RELAY_REGISTER_OK }));
          log(`[Costa MCP] Relay peer connected to bridge (pid ${process.pid})`);
          return;
        }
        if (role === "pending") role = "browser";

        if (role !== "relay" || msg.type !== RELAY_REQUEST) return;

        const relayRequestId = String(msg.relayRequestId ?? "");
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (!relayRequestId || !payload) return;

        try {
          const result = await forwardToBrowser(payload);
          socket.send(
            JSON.stringify({
              type: RELAY_RESPONSE,
              relayRequestId,
              ok: true,
              result,
            })
          );
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: RELAY_RESPONSE,
              relayRequestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          );
        }
      } catch {
        /* ignore malformed */
      }
    });
  });
}

export function sendJsonViaBridgeRelay(
  port: number,
  message: Record<string, unknown>,
  log: (msg: string) => void
): Promise<Record<string, unknown>> {
  const url = `ws://127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    const socket = new WsClient(url);
    const relayRequestId = Math.random().toString(36).slice(2);
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Timeout waiting for relay response from Costa MCP bridge")));
    }, 60000);

    socket.on("error", (err) => {
      finish(() => reject(err));
    });

    socket.on("open", () => {
      log(`[Costa MCP] Relay client pid=${process.pid} -> ${url}`);
      socket.send(JSON.stringify({ type: RELAY_REGISTER }));
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === RELAY_REGISTER_OK) {
          socket.send(
            JSON.stringify({
              type: RELAY_REQUEST,
              relayRequestId,
              payload: message,
            })
          );
          return;
        }
        if (msg.type === RELAY_RESPONSE && msg.relayRequestId === relayRequestId) {
          if (msg.ok === false) {
            finish(() => reject(new Error(String(msg.error ?? "Relay failed"))));
          } else {
            finish(() => resolve((msg.result as Record<string, unknown>) ?? {}));
          }
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  });
}
