import cors from "cors";
import express from "express";
import helmet from "helmet";
import { publicRouter } from "./routes/public.js";

export function createApp() {
  const app = express();
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: frontendUrl }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/v1/health", (_request, response) => {
    response.json({
      data: {
        status: "ok",
        service: "agenda-local-api",
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use("/api/v1", publicRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: "Ruta no encontrada" });
  });

  return app;
}
