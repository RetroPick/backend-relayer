import WebSocket from "ws";

export type YellowWsConfig = {
  url: string;
};

export function connectYellowWS(cfg: YellowWsConfig) {
  const ws = new WebSocket(cfg.url);

  ws.on("open", () => {
    console.log(`✅ Yellow WS connected: ${cfg.url}`);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log("🟡 Yellow message:", msg);
    } catch (e) {
      console.log("🟡 Yellow raw:", data.toString());
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`🟡 Yellow WS closed: ${code} ${reason?.toString?.() ?? ""}`);
  });

  ws.on("error", (err) => {
    console.error("🟡 Yellow WS error:", err);
  });

  return ws;
}
