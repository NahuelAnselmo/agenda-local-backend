import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { resetDemoData } from "../src/services/demo-data.js";

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DEMO_SEED !== "true"
) {
  throw new Error(
    "El seed ficticio está bloqueado en producción. Usá un flujo de alta seguro.",
  );
}

resetDemoData()
  .then(() => console.log("Datos ficticios cargados correctamente"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
