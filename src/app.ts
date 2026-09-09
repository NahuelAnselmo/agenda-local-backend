import cors from "cors";
import express from "express";
import helmet from "helmet";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";

export function createApp() {
  const app = express();
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: frontendUrl, credentials: true }));
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
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/admin", adminRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: "Ruta no encontrada" });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(error);
      response.status(500).json({ error: "Ocurrió un error inesperado" });
    },
  );

  return app;
}
