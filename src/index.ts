import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerApiRoutes } from "./api/routes.js";
import { registerCreRoutes } from "./api/creRoutes.js";

async function main() {
  console.log("Starting relayer...");
  console.log("CWD:", process.cwd());
  console.log("PORT:", process.env.PORT, "RELAYER_PORT:", process.env.RELAYER_PORT);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.get("/debug", async () => ({
    port: process.env.PORT ?? process.env.RELAYER_PORT ?? null,
    channelSettlementConfigured: !!process.env.CHANNEL_SETTLEMENT_ADDRESS,
    operatorConfigured: !!process.env.OPERATOR_PRIVATE_KEY,
  }));

  await registerApiRoutes(app);
  await registerCreRoutes(app);

  const port = Number(process.env.PORT ?? process.env.RELAYER_PORT ?? "8790");
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
    console.log(`Relayer listening at http://${host}:${port}`);
  } catch (err) {
    console.error("Failed to start relayer:", err);
    process.exit(1);
  }
}

main();
