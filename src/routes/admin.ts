import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/session.js";
import { hashPassword } from "../auth/password.js";
import {
  generateTimeSlots,
  toAppointmentRange,
  weekdayForDate,
} from "../data/demo.js";
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
const staffAccessBody = z.object({
  email: z.email(),
  temporaryPassword: z.string().min(8).max(128),
});
const businessPatch = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  category: z.string().trim().min(2).max(100).optional(),
  address: z.string().trim().max(160).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.union([z.email(), z.literal(""), z.null()]).optional(),
  scheduleText: z.string().trim().max(120).nullable().optional(),
});
const appointmentStatus = z.enum([
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
]);
const appointmentQuery = z
  .object({
    status: appointmentStatus.optional(),
    staffId: z.string().min(1).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    q: z.string().trim().max(100).optional(),
  })
  .refine(
    ({ from, to }) => !from || !to || new Date(from) <= new Date(to),
    { message: "El rango de fechas es inválido" },
  );
const appointmentCreateBody = z.object({
  serviceId: z.string().min(1),
  staffId: z.string().min(1),
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  source: z.enum(["WHATSAPP", "PHONE", "WALK_IN"]).default("WHATSAPP"),
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(6).max(30),
    email: z.union([z.email(), z.literal("")]).optional(),
  }),
  notes: z.string().trim().max(500).nullable().optional(),
});
const appointmentPatch = z
  .object({
    status: appointmentStatus.optional(),
    schedule: z
      .object({
        serviceId: z.string().min(1),
        staffId: z.string().min(1),
        date: z.iso.date(),
        time: z.string().regex(/^\d{2}:\d{2}$/),
      })
      .optional(),
  })
  .refine(({ status, schedule }) => status !== undefined || schedule !== undefined, {
    message: "No hay cambios para aplicar",
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

function requireOwner(_request: Request, response: Response, next: NextFunction) {
  if (response.locals.auth.membership.role !== "OWNER") {
    return response.status(403).json({ error: "Permiso de propietario requerido" });
  }
  return next();
}

function staffScope(response: Response) {
  if (response.locals.auth.membership.role === "OWNER") return null;
  const profile = response.locals.auth.user.staffProfile;
  if (
    !profile ||
    profile.organizationId !== response.locals.auth.organization.id ||
    profile.archivedAt
  ) {
    return undefined;
  }
  return profile.id as string;
}

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
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }
  const appointmentScope = scopedStaffId ? { staffId: scopedStaffId } : {};
  const now = new Date();
  const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [appointments, services, staff, availability, weekCount, completed] =
    await Promise.all([
      prisma.appointment.findMany({
        where: {
          organizationId,
          ...appointmentScope,
          startAt: { gte: now },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        include: { service: true, staff: true },
        orderBy: { startAt: "asc" },
        take: 12,
      }),
      prisma.service.findMany({
        where: {
          organizationId,
          ...(scopedStaffId
            ? { staff: { some: { staffId: scopedStaffId } } }
            : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.staff.findMany({
        where: {
          organizationId,
          ...(scopedStaffId ? { id: scopedStaffId } : {}),
        },
        include: {
          services: true,
          user: {
            select: {
              email: true,
              memberships: {
                where: { organizationId },
                select: { id: true },
              },
            },
          },
        },
        orderBy: { displayName: "asc" },
      }),
      prisma.weeklyAvailability.findMany({
        where: { organizationId, staffId: null },
        orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
      }),
      prisma.appointment.count({
        where: {
          organizationId,
          ...appointmentScope,
          startAt: { gte: now, lt: endOfWeek },
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] },
        },
      }),
      prisma.appointment.findMany({
        where: {
          organizationId,
          ...appointmentScope,
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
        activeStaff: staff.filter((member) => member.active && !member.archivedAt).length,
        monthlyRevenueInCents: revenueInCents,
      },
      business: response.locals.auth.organization,
      account: {
        user: {
          id: response.locals.auth.user.id,
          name: response.locals.auth.user.name,
          email: response.locals.auth.user.email,
        },
        role: response.locals.auth.membership.role,
        staffId: scopedStaffId,
      },
      appointments,
      services,
      staff,
      availability,
    },
  });
});

adminRouter.patch("/business", requireOwner, async (request, response) => {
  const parsed = businessPatch.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos del negocio inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const data: Prisma.OrganizationUpdateInput = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.category !== undefined
      ? { category: parsed.data.category }
      : {}),
    ...(parsed.data.address !== undefined
      ? { address: parsed.data.address }
      : {}),
    ...(parsed.data.location !== undefined
      ? { location: parsed.data.location }
      : {}),
    ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
    ...(parsed.data.email !== undefined
      ? { email: parsed.data.email || null }
      : {}),
    ...(parsed.data.scheduleText !== undefined
      ? { scheduleText: parsed.data.scheduleText }
      : {}),
  };
  const business = await prisma.organization.update({
    where: { id: organizationId },
    data,
  });

  return response.json({ data: business });
});

adminRouter.get("/appointments", async (request, response) => {
  const parsed = appointmentQuery.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({ error: "Filtros de agenda inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }
  const { status, staffId, from, to, q } = parsed.data;
  const where: Prisma.AppointmentWhereInput = {
    organizationId,
    ...(status ? { status } : {}),
    ...(scopedStaffId ? { staffId: scopedStaffId } : staffId ? { staffId } : {}),
    ...(from || to
      ? {
          startAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { customerName: { contains: q, mode: "insensitive" } },
            { customerEmail: { contains: q, mode: "insensitive" } },
            { customerPhone: { contains: q } },
          ],
        }
      : {}),
  };
  const appointments = await prisma.appointment.findMany({
    where,
    include: { service: true, staff: true },
    orderBy: { startAt: "asc" },
    take: 100,
  });

  return response.json({ data: appointments });
});

adminRouter.post("/appointments", async (request, response) => {
  const parsed = appointmentCreateBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos del turno inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }

  const { serviceId, staffId, date, time, customer, source, notes } = parsed.data;
  if (scopedStaffId && staffId !== scopedStaffId) {
    return response.status(403).json({
      error: "Sólo podés agregar turnos a tu propia agenda",
    });
  }

  const [service, staff] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, organizationId, active: true },
    }),
    prisma.staff.findFirst({
      where: {
        id: staffId,
        organizationId,
        active: true,
        archivedAt: null,
        services: { some: { serviceId } },
      },
    }),
  ]);
  if (!service || !staff) {
    return response.status(400).json({
      error: "El servicio o profesional seleccionado no está disponible",
    });
  }

  const intervals = await prisma.weeklyAvailability.findMany({
    where: {
      organizationId,
      weekday: weekdayForDate(date),
      staffId: null,
    },
  });
  if (!generateTimeSlots(intervals, service.durationMinutes).includes(time)) {
    return response.status(400).json({
      error: "El horario está fuera de la jornada de atención",
    });
  }

  const range = toAppointmentRange(date, time, service.durationMinutes);
  const [conflict, timeOff] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        staffId,
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { lt: range.endAt },
        endAt: { gt: range.startAt },
      },
    }),
    prisma.timeOff.findFirst({
      where: {
        organizationId,
        OR: [{ staffId: null }, { staffId }],
        startAt: { lt: range.endAt },
        endAt: { gt: range.startAt },
      },
    }),
  ]);
  if (conflict || timeOff) {
    return response.status(409).json({
      error: "Ese horario ya no está disponible",
    });
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        organizationId,
        serviceId,
        staffId,
        startAt: range.startAt,
        endAt: range.endAt,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email || null,
        notes: notes || null,
        source,
        status: "CONFIRMED",
        cancelToken: randomBytes(24).toString("hex"),
      },
      include: { service: true, staff: true },
    });
    return response.status(201).json({ data: appointment });
  } catch (error) {
    if (String(error).includes("appointment_no_staff_overlap")) {
      return response.status(409).json({
        error: "Ese horario ya no está disponible",
      });
    }
    throw error;
  }
});

adminRouter.put("/availability", requireOwner, async (request, response) => {
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

adminRouter.post("/services", requireOwner, async (request, response) => {
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

adminRouter.patch("/services/:id", requireOwner, async (request, response) => {
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
    where: { id: String(request.params.id), organizationId },
    data,
  });
  if (result.count === 0) {
    return response.status(404).json({ error: "Servicio no encontrado" });
  }
  const service = await prisma.service.findUnique({
    where: { id: String(request.params.id) },
  });
  return response.json({ data: service });
});

adminRouter.patch("/appointments/:id", async (request, response) => {
  const parsed = appointmentPatch.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Estado inválido" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: String(request.params.id),
      organizationId,
      ...(scopedStaffId ? { staffId: scopedStaffId } : {}),
    },
  });
  if (!appointment) {
    return response.status(404).json({ error: "Turno no encontrado" });
  }

  let scheduleData: {
    serviceId: string;
    staffId: string;
    startAt: Date;
    endAt: Date;
  } | null = null;

  if (parsed.data.schedule) {
    const { serviceId, staffId, date, time } = parsed.data.schedule;
    if (scopedStaffId && staffId !== scopedStaffId) {
      return response.status(403).json({
        error: "Sólo podés reprogramar turnos de tu propia agenda",
      });
    }
    const [service, staff] = await Promise.all([
      prisma.service.findFirst({
        where: { id: serviceId, organizationId, active: true },
      }),
      prisma.staff.findFirst({
        where: {
          id: staffId,
          organizationId,
          active: true,
          services: { some: { serviceId } },
        },
      }),
    ]);
    if (!service || !staff) {
      return response.status(400).json({
        error: "El servicio o profesional seleccionado no está disponible",
      });
    }

    const intervals = await prisma.weeklyAvailability.findMany({
      where: {
        organizationId,
        weekday: weekdayForDate(date),
        staffId: null,
      },
    });
    if (!generateTimeSlots(intervals, service.durationMinutes).includes(time)) {
      return response.status(400).json({
        error: "El horario está fuera de la jornada de atención",
      });
    }

    const range = toAppointmentRange(date, time, service.durationMinutes);
    const [conflict, timeOff] = await Promise.all([
      prisma.appointment.findFirst({
        where: {
          id: { not: appointment.id },
          staffId,
          status: { in: ["PENDING", "CONFIRMED"] },
          startAt: { lt: range.endAt },
          endAt: { gt: range.startAt },
        },
      }),
      prisma.timeOff.findFirst({
        where: {
          organizationId,
          OR: [{ staffId: null }, { staffId }],
          startAt: { lt: range.endAt },
          endAt: { gt: range.startAt },
        },
      }),
    ]);
    if (conflict || timeOff) {
      return response.status(409).json({
        error: "Ese horario ya no está disponible",
      });
    }

    scheduleData = {
      serviceId: service.id,
      staffId: staff.id,
      startAt: range.startAt,
      endAt: range.endAt,
    };
  }

  try {
    const updated = await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(scheduleData ?? {}),
      },
      include: { service: true, staff: true },
    });
    return response.json({ data: updated });
  } catch (error) {
    if (String(error).includes("appointment_no_staff_overlap")) {
      return response.status(409).json({
        error: "Ese horario ya no está disponible",
      });
    }
    throw error;
  }
});

adminRouter.post("/staff", requireOwner, async (request, response) => {
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

adminRouter.patch("/staff/:id", requireOwner, async (request, response) => {
  const parsed = staffPatch.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Datos de profesional inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const existing = await prisma.staff.findFirst({
    where: { id: String(request.params.id), organizationId },
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

adminRouter.delete("/staff/:id", requireOwner, async (request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const member = await prisma.staff.findFirst({
    where: {
      id: String(request.params.id),
      organizationId,
      archivedAt: null,
    },
  });
  if (!member) {
    return response.status(404).json({ error: "Profesional no encontrado" });
  }

  await prisma.$transaction(async (transaction) => {
    if (member.userId) {
      await transaction.session.deleteMany({ where: { userId: member.userId } });
      await transaction.membership.deleteMany({
        where: { userId: member.userId, organizationId },
      });
    }
    await transaction.staff.update({
      where: { id: member.id },
      data: { active: false, archivedAt: new Date() },
    });
  });

  return response.status(204).send();
});

adminRouter.post("/staff/:id/restore", requireOwner, async (request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const member = await prisma.staff.findFirst({
    where: {
      id: String(request.params.id),
      organizationId,
      archivedAt: { not: null },
    },
  });
  if (!member) {
    return response.status(404).json({ error: "Profesional no encontrado" });
  }

  const restored = await prisma.staff.update({
    where: { id: member.id },
    data: { active: true, archivedAt: null },
    include: { services: true },
  });
  return response.json({ data: restored });
});

adminRouter.put("/staff/:id/access", requireOwner, async (request, response) => {
  const parsed = staffAccessBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Datos de acceso inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const member = await prisma.staff.findFirst({
    where: {
      id: String(request.params.id),
      organizationId,
      archivedAt: null,
    },
  });
  if (!member) {
    return response.status(404).json({ error: "Profesional no encontrado" });
  }

  const email = parsed.data.email.toLowerCase();
  const emailOwner = await prisma.user.findUnique({ where: { email } });
  if (emailOwner && emailOwner.id !== member.userId) {
    return response.status(409).json({ error: "Ese email ya está en uso" });
  }

  const passwordHash = await hashPassword(parsed.data.temporaryPassword);
  const user = await prisma.$transaction(async (transaction) => {
    const accessUser = member.userId
      ? await transaction.user.update({
          where: { id: member.userId },
          data: { name: member.displayName, email, passwordHash },
        })
      : await transaction.user.create({
          data: { name: member.displayName, email, passwordHash },
        });

    await transaction.membership.upsert({
      where: {
        userId_organizationId: {
          userId: accessUser.id,
          organizationId,
        },
      },
      update: { role: "STAFF" },
      create: { userId: accessUser.id, organizationId, role: "STAFF" },
    });
    await transaction.staff.update({
      where: { id: member.id },
      data: { userId: accessUser.id },
    });
    await transaction.session.deleteMany({ where: { userId: accessUser.id } });
    return accessUser;
  });

  return response.json({
    data: { user: { id: user.id, name: user.name, email: user.email } },
  });
});

adminRouter.delete("/staff/:id/access", requireOwner, async (request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const member = await prisma.staff.findFirst({
    where: { id: String(request.params.id), organizationId },
  });
  if (!member) {
    return response.status(404).json({ error: "Profesional no encontrado" });
  }
  if (member.userId) {
    await prisma.$transaction([
      prisma.membership.deleteMany({
        where: { userId: member.userId, organizationId },
      }),
      prisma.session.deleteMany({ where: { userId: member.userId } }),
    ]);
  }
  return response.status(204).send();
});
