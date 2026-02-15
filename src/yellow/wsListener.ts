/**
 * Yellow WebSocket listener using Nitrolite SDK.
 * Connects to ClearNode, parses RPC responses, and invokes callbacks for channel/session events.
 */
import WebSocket from "ws";
import { parseAnyRPCResponse } from "@erc7824/nitrolite";

export type YellowWsConfig = {
  url: string;
};

export type YellowMessageCallback = (msg: unknown) => void;

let messageCallback: YellowMessageCallback | null = null;

export function setYellowMessageCallback(cb: YellowMessageCallback): void {
  messageCallback = cb;
}

export function connectYellowWS(cfg: YellowWsConfig): WebSocket {
  const ws = new WebSocket(cfg.url);

  ws.on("open", () => {
    console.log(`[Yellow] Connected: ${cfg.url}`);
  });

  ws.on("message", (data) => {
    try {
      const raw = data.toString();
      const parsed = parseAnyRPCResponse(raw);
      console.log("[Yellow] Message:", JSON.stringify(parsed).slice(0, 200));
      messageCallback?.(parsed);
    } catch {
      try {
        const msg = JSON.parse(data.toString());
        console.log("[Yellow] Raw JSON:", msg);
        messageCallback?.(msg);
      } catch {
        console.log("[Yellow] Raw:", data.toString().slice(0, 100));
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[Yellow] Closed: ${code} ${reason?.toString() ?? ""}`);
  });

  ws.on("error", (err) => {
    console.error("[Yellow] Error:", err);
  });

  return ws;
}
