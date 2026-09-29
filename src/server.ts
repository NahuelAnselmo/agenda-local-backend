import "dotenv/config";
import app from "./app.js";

const port = Number(process.env.PORT ?? 4000);
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log("Agenda Local API disponible en http://localhost:" + port);
  });
}

export default app;
