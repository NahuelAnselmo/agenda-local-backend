import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { resetDemoData } from "../services/demo-data.js";

export const demoRouter = Router();

function authorized(header: string | undefined, secret: string) {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

demoRouter.get("/reset", async (request, response) => {
  if (process.env.DEMO_MODE !== "true") {
    return response.status(404).json({ error: "Ruta no encontrada" });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request.get("authorization"), secret)) {
    return response.status(401).json({ error: "Acceso no autorizado" });
  }

  await resetDemoData();
  return response.json({ data: { resetAt: new Date().toISOString() } });
});
