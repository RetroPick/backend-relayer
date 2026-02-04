import dotenv from "dotenv";
import { connectYellowWS } from "./yellow/ws";

dotenv.config(); // loads .env from current working directory

import Fastify from "fastify";
import cors from "@fastify/cors";

async function main() {
  console.log("Starting relayer...");
  console.log("CWD:", process.cwd());
  console.log("RELAYER_PORT:", process.env.RELAYER_PORT);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  const port = Number(process.env.RELAYER_PORT ?? "8790");
  const host = "127.0.0.1";

  const yellowUrl = process.env.YELLOW_WS_URL ?? "wss://clearnet-sandbox.yellow.com/ws";
  connectYellowWS({ url: yellowUrl });
  
  app.get("/debug", async () => ({
    relayerPort: process.env.RELAYER_PORT ?? null,
    yellowWsUrl: process.env.YELLOW_WS_URL ?? null,
  }));
  
  try {
    await app.listen({ port, host });
    console.log(`✅ Relayer listening at http://${host}:${port}`);
  } catch (err) {
    console.error("❌ Failed to start relayer:", err);
    process.exit(1);
  }
}

main();
