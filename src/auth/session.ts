import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

const SESSION_COOKIE = "agenda_local_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getCookie(request: Request, name: string) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const cookie = cookies
    .map((item) => item.trim().split("="))
    .find(([cookieName]) => cookieName === name);
  return cookie?.[1] ? decodeURIComponent(cookie[1]) : undefined;
}

export async function startSession(userId: string, response: Response) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS,
    path: "/",
  });
}

export async function endSession(request: Request, response: Response) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) {
    return response.status(401).json({ error: "Sesión requerida" });
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashToken(token),
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        include: {
          memberships: {
            include: { organization: true },
            take: 1,
          },
        },
      },
    },
  });

  const membership = session?.user.memberships[0];
  if (!session || !membership) {
    return response.status(401).json({ error: "Sesión inválida o vencida" });
  }

  response.locals.auth = {
    user: session.user,
    membership,
    organization: membership.organization,
  };
  return next();
}
