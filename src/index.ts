import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import cors from "@fastify/cors";
import { connectYellowWS } from "./yellow/wsListener.js";
import { registerApiRoutes } from "./api/routes.js";
import { registerCreRoutes } from "./api/creRoutes.js";
import { getNitroliteClient } from "./yellow/nitroliteClient.js";

async function main() {
  console.log("Starting relayer...");
  console.log("CWD:", process.cwd());
  console.log("RELAYER_PORT:", process.env.RELAYER_PORT);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.get("/debug", async () => ({
    relayerPort: process.env.RELAYER_PORT ?? null,
    yellowWsUrl: process.env.YELLOW_WS_URL ?? null,
    nitroliteConfigured: !!process.env.OPERATOR_PRIVATE_KEY,
  }));

  await registerApiRoutes(app);
  await registerCreRoutes(app);

  const yellowUrl = process.env.YELLOW_WS_URL ?? "wss://clearnet-sandbox.yellow.com/ws";
  connectYellowWS({ url: yellowUrl });

  const client = await getNitroliteClient();
  if (client) {
    console.log("[Nitrolite] Client initialized");
  } else {
    console.log("[Nitrolite] Client disabled (no OPERATOR_PRIVATE_KEY)");
  }

  const port = Number(process.env.RELAYER_PORT ?? "8790");
  const host = "127.0.0.1";

  try {
    await app.listen({ port, host });
    console.log(`Relayer listening at http://${host}:${port}`);
  } catch (err) {
    console.error("Failed to start relayer:", err);
    process.exit(1);
  }
}

main();
