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
const staffBody = z.object({
  displayName: z.string().trim().min(2).max(80),
  roleTitle: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(320).nullable().optional(),
  serviceIds: z.array(z.string().min(1)).max(40),
  active: z.boolean().optional(),
});
const staffPatch = staffBody.partial();
const appointmentPatch = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]),
});
const availabilityBody = z.object({
  intervals: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ).max(28),
});

export const adminRouter = Router();
adminRouter.use(requireAuth);

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

async function organizationOwnsServices(
  organizationId: string,
  serviceIds: string[],
) {
  const uniqueServiceIds = [...new Set(serviceIds)];
  const count = await prisma.service.count({
    where: { id: { in: uniqueServiceIds }, organizationId },
  });
  return count === uniqueServiceIds.length;
}

adminRouter.get("/dashboard", async (_request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const now = new Date();
  const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [appointments, services, staff, availability, weekCount, completed] =
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
      prisma.weeklyAvailability.findMany({
        where: { organizationId, staffId: null },
        orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
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
      availability,
    },
  });
});

adminRouter.put("/availability", async (request, response) => {
  const parsed = availabilityBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Horarios inválidos" });
  }
  if (
    parsed.data.intervals.some(
      (interval) => interval.startTime >= interval.endTime,
    )
  ) {
    return response.status(400).json({
      error: "La hora de cierre debe ser posterior a la de apertura",
    });
  }

  const organizationId = response.locals.auth.organization.id as string;
  await prisma.$transaction([
    prisma.weeklyAvailability.deleteMany({
      where: { organizationId, staffId: null },
    }),
    prisma.weeklyAvailability.createMany({
      data: parsed.data.intervals.map((interval) => ({
        ...interval,
        organizationId,
      })),
    }),
  ]);

  return response.json({ data: parsed.data.intervals });
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

adminRouter.post("/staff", async (request, response) => {
  const parsed = staffBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos de profesional inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const serviceIds = [...new Set(parsed.data.serviceIds)];
  if (!(await organizationOwnsServices(organizationId, serviceIds))) {
    return response.status(400).json({
      error: "Uno o más servicios no pertenecen al negocio",
    });
  }

  const staffCount = await prisma.staff.count({ where: { organizationId } });
  const accents = ["terracotta", "sage", "sand"];
  const member = await prisma.staff.create({
    data: {
      displayName: parsed.data.displayName,
      roleTitle: parsed.data.roleTitle ?? null,
      bio: parsed.data.bio ?? null,
      initials: initialsFor(parsed.data.displayName),
      accent: accents[staffCount % accents.length] ?? "sage",
      active: parsed.data.active ?? true,
      organizationId,
      services: {
        create: serviceIds.map((serviceId) => ({ serviceId })),
      },
    },
    include: { services: true },
  });

  return response.status(201).json({ data: member });
});

adminRouter.patch("/staff/:id", async (request, response) => {
  const parsed = staffPatch.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Datos de profesional inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const existing = await prisma.staff.findFirst({
    where: { id: request.params.id, organizationId },
  });
  if (!existing) {
    return response.status(404).json({ error: "Profesional no encontrado" });
  }

  const serviceIds = parsed.data.serviceIds
    ? [...new Set(parsed.data.serviceIds)]
    : undefined;
  if (
    serviceIds &&
    !(await organizationOwnsServices(organizationId, serviceIds))
  ) {
    return response.status(400).json({
      error: "Uno o más servicios no pertenecen al negocio",
    });
  }

  const member = await prisma.staff.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.displayName !== undefined
        ? {
            displayName: parsed.data.displayName,
            initials: initialsFor(parsed.data.displayName),
          }
        : {}),
      ...(parsed.data.roleTitle !== undefined
        ? { roleTitle: parsed.data.roleTitle }
        : {}),
      ...(parsed.data.bio !== undefined ? { bio: parsed.data.bio } : {}),
      ...(parsed.data.active !== undefined
        ? { active: parsed.data.active }
        : {}),
      ...(serviceIds
        ? {
            services: {
              deleteMany: {},
              create: serviceIds.map((serviceId) => ({ serviceId })),
            },
          }
        : {}),
    },
    include: { services: true },
  });

  return response.json({ data: member });
});
