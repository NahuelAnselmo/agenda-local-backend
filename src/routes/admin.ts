import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/session.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const serviceBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).nullable().optional(),
  durationMinutes: z.number().int().min(10).max(480),
  priceInCents: z.number().int().min(0),
  active: z.boolean().optional(),
});

const servicePatch = serviceBody.partial();
const appointmentPatch = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]),
});

export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get("/dashboard", async (_request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const now = new Date();
  const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [appointments, services, staff, weekCount, completed] =
    await Promise.all([
      prisma.appointment.findMany({
        where: {
          organizationId,
          startAt: { gte: now },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        include: { service: true, staff: true },
        orderBy: { startAt: "asc" },
        take: 12,
      }),
      prisma.service.findMany({
        where: { organizationId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.staff.findMany({
        where: { organizationId },
        include: { services: true },
        orderBy: { displayName: "asc" },
      }),
      prisma.appointment.count({
        where: {
          organizationId,
          startAt: { gte: now, lt: endOfWeek },
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] },
        },
      }),
      prisma.appointment.findMany({
        where: {
          organizationId,
          status: "COMPLETED",
          startAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        },
        include: { service: true },
      }),
    ]);

  const revenueInCents = completed.reduce(
    (total, appointment) => total + appointment.service.priceInCents,
    0,
  );

  return response.json({
    data: {
      metrics: {
        weekAppointments: weekCount,
        activeServices: services.filter((service) => service.active).length,
        activeStaff: staff.filter((member) => member.active).length,
        monthlyRevenueInCents: revenueInCents,
      },
      appointments,
      services,
      staff,
    },
  });
});

adminRouter.post("/services", async (request, response) => {
  const parsed = serviceBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos de servicio inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const lastService = await prisma.service.findFirst({
    where: { organizationId },
    orderBy: { sortOrder: "desc" },
  });
  const service = await prisma.service.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      durationMinutes: parsed.data.durationMinutes,
      priceInCents: parsed.data.priceInCents,
      active: parsed.data.active ?? true,
      organizationId,
      sortOrder: (lastService?.sortOrder ?? 0) + 1,
    },
  });
  return response.status(201).json({ data: service });
});

adminRouter.patch("/services/:id", async (request, response) => {
  const parsed = servicePatch.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Datos de servicio inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const data: Prisma.ServiceUpdateManyMutationInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description;
  }
  if (parsed.data.durationMinutes !== undefined) {
    data.durationMinutes = parsed.data.durationMinutes;
  }
  if (parsed.data.priceInCents !== undefined) {
    data.priceInCents = parsed.data.priceInCents;
  }
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  const result = await prisma.service.updateMany({
    where: { id: request.params.id, organizationId },
    data,
  });
  if (result.count === 0) {
    return response.status(404).json({ error: "Servicio no encontrado" });
  }
  const service = await prisma.service.findUnique({
    where: { id: request.params.id },
  });
  return response.json({ data: service });
});

adminRouter.patch("/appointments/:id", async (request, response) => {
  const parsed = appointmentPatch.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Estado inválido" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const result = await prisma.appointment.updateMany({
    where: { id: request.params.id, organizationId },
    data: { status: parsed.data.status },
  });
  if (result.count === 0) {
    return response.status(404).json({ error: "Turno no encontrado" });
  }
  return response.json({ data: { id: request.params.id, ...parsed.data } });
});

adminRouter.patch("/staff/:id", async (request, response) => {
  const parsed = z
    .object({
      displayName: z.string().trim().min(2).max(80).optional(),
      roleTitle: z.string().trim().max(80).nullable().optional(),
      active: z.boolean().optional(),
    })
    .safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Datos de profesional inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const data: Prisma.StaffUpdateManyMutationInput = {};
  if (parsed.data.displayName !== undefined) {
    data.displayName = parsed.data.displayName;
  }
  if (parsed.data.roleTitle !== undefined) data.roleTitle = parsed.data.roleTitle;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  const result = await prisma.staff.updateMany({
    where: { id: request.params.id, organizationId },
    data,
  });
  if (result.count === 0) {
    return response.status(404).json({ error: "Profesional no encontrado" });
  }
  return response.json({ data: { id: request.params.id, ...parsed.data } });
});
