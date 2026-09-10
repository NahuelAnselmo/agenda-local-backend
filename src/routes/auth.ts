import { Router } from "express";
import { z } from "zod";
import { endSession, requireAuth, startSession } from "../auth/session.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { prisma } from "../lib/prisma.js";

const loginBody = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});
const credentialsBody = z
  .object({
    currentPassword: z.string().min(8).max(128),
    name: z.string().trim().min(2).max(100).optional(),
    email: z.email().optional(),
    newPassword: z.string().min(8).max(128).optional(),
  })
  .refine(
    ({ name, email, newPassword }) =>
      name !== undefined || email !== undefined || newPassword !== undefined,
    { message: "No hay cambios para aplicar" },
  );

export const authRouter = Router();

authRouter.post("/login", async (request, response) => {
  const parsed = loginBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Email o contraseña inválidos" });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { memberships: { include: { organization: true }, take: 1 } },
  });

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return response.status(401).json({ error: "Email o contraseña incorrectos" });
  }

  await prisma.session.deleteMany({
    where: { userId: user.id, expiresAt: { lt: new Date() } },
  });
  await startSession(user.id, response);

  return response.json({
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      membership: user.memberships[0],
    },
  });
});

authRouter.post("/logout", async (request, response) => {
  await endSession(request, response);
  return response.status(204).send();
});

authRouter.get("/me", requireAuth, (_request, response) => {
  const { user, membership, organization } = response.locals.auth;
  return response.json({
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      role: membership.role,
      organization,
    },
  });
});

authRouter.patch("/me/credentials", requireAuth, async (request, response) => {
  const parsed = credentialsBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos de cuenta inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const user = response.locals.auth.user as {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
  };
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return response.status(401).json({ error: "La contraseña actual es incorrecta" });
  }

  const email = parsed.data.email?.toLowerCase();
  if (email && email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return response.status(409).json({ error: "Ese email ya está en uso" });
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(parsed.data.newPassword !== undefined
        ? { passwordHash: await hashPassword(parsed.data.newPassword) }
        : {}),
    },
  });

  if (parsed.data.newPassword) {
    await prisma.session.deleteMany({
      where: { userId: user.id, id: { not: response.locals.auth.session.id } },
    });
  }

  return response.json({
    data: { user: { id: updated.id, name: updated.name, email: updated.email } },
  });
});
