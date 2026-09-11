import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  generateTimeSlots,
  toAppointmentRange,
  weekdayForDate,
} from "../data/demo.js";
import { prisma } from "../lib/prisma.js";

const availabilityQuery = z.object({
  serviceId: z.string().min(1),
  staffId: z.string().min(1).optional(),
  date: z.iso.date(),
});

const appointmentBody = z.object({
  serviceId: z.string().min(1),
  staffId: z.string().min(1).nullable(),
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.email(),
    phone: z.string().trim().min(6).max(30),
  }),
});

export const publicRouter = Router();

publicRouter.get("/appointments/:token", async (request, response) => {
  const appointment = await prisma.appointment.findUnique({
    where: { cancelToken: request.params.token },
    include: { organization: true, service: true, staff: true },
  });
  if (!appointment) {
    return response.status(404).json({ error: "Reserva no encontrada" });
  }

  return response.json({
    data: {
      id: appointment.id,
      status: appointment.status,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      customerName: appointment.customerName,
      organization: appointment.organization,
      service: appointment.service,
      staff: appointment.staff,
    },
  });
});

publicRouter.patch("/appointments/:token/cancel", async (request, response) => {
  const appointment = await prisma.appointment.findUnique({
    where: { cancelToken: request.params.token },
  });
  if (!appointment) {
    return response.status(404).json({ error: "Reserva no encontrada" });
  }
  if (appointment.status === "COMPLETED") {
    return response.status(409).json({
      error: "Un turno completado no puede cancelarse",
    });
  }

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { status: "CANCELLED" },
  });
  return response.json({ data: { id: updated.id, status: updated.status } });
});

publicRouter.get("/businesses/:slug", async (request, response) => {
  const business = await prisma.organization.findUnique({
    where: { slug: request.params.slug },
    include: {
      services: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
      staff: {
        where: { active: true, archivedAt: null },
        include: { services: true },
        orderBy: { displayName: "asc" },
      },
    },
  });

  if (!business) {
    return response.status(404).json({ error: "Negocio no encontrado" });
  }

  return response.json({
    data: {
      ...business,
      staff: business.staff.map((member) => ({
        ...member,
        serviceIds: member.services.map((item) => item.serviceId),
      })),
    },
  });
});

publicRouter.get("/businesses/:slug/availability", async (request, response) => {
  const parsed = availabilityQuery.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Parámetros inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const business = await prisma.organization.findUnique({
    where: { slug: request.params.slug },
  });
  if (!business) {
    return response.status(404).json({ error: "Negocio no encontrado" });
  }

  const service = await prisma.service.findFirst({
    where: {
      id: parsed.data.serviceId,
      organizationId: business.id,
      active: true,
    },
  });
  if (!service) {
    return response.status(404).json({ error: "Servicio no encontrado" });
  }

  const eligibleStaff = await prisma.staff.findMany({
    where: {
      organizationId: business.id,
      active: true,
      archivedAt: null,
      ...(parsed.data.staffId ? { id: parsed.data.staffId } : {}),
      services: { some: { serviceId: service.id } },
    },
  });

  const intervals = await prisma.weeklyAvailability.findMany({
    where: {
      organizationId: business.id,
      weekday: weekdayForDate(parsed.data.date),
      staffId: null,
    },
    orderBy: { startTime: "asc" },
  });
  const candidateTimes = generateTimeSlots(
    intervals,
    service.durationMinutes,
  );
  const ranges = candidateTimes.map((time) => ({
    time,
    ...toAppointmentRange(parsed.data.date, time, service.durationMinutes),
  }));
  const dayStart = toAppointmentRange(parsed.data.date, "00:00", 1).startAt;
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const [appointments, timeOff] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        staffId: { in: eligibleStaff.map((staff) => staff.id) },
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
    }),
    prisma.timeOff.findMany({
      where: {
        organizationId: business.id,
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
    }),
  ]);

  const slots = ranges.filter((range) => {
    return eligibleStaff.some(
      (staff) =>
        !appointments.some(
          (appointment) =>
            appointment.staffId === staff.id &&
            appointment.startAt < range.endAt &&
            appointment.endAt > range.startAt,
        ) &&
        !timeOff.some(
          (block) =>
            (!block.staffId || block.staffId === staff.id) &&
            block.startAt < range.endAt &&
            block.endAt > range.startAt,
        ),
    );
  }).map((range) => range.time);

  return response.json({ data: { date: parsed.data.date, slots } });
});

publicRouter.post("/businesses/:slug/appointments", async (request, response) => {
  const parsed = appointmentBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos de reserva inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const { serviceId, staffId, date, time, customer } = parsed.data;
  const business = await prisma.organization.findUnique({
    where: { slug: request.params.slug },
  });
  if (!business) {
    return response.status(404).json({ error: "Negocio no encontrado" });
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId, organizationId: business.id, active: true },
  });
  if (!service) {
    return response.status(404).json({ error: "Servicio u horario no disponible" });
  }

  const eligibleStaff = await prisma.staff.findMany({
    where: {
      organizationId: business.id,
      active: true,
      archivedAt: null,
      ...(staffId ? { id: staffId } : {}),
      services: { some: { serviceId: service.id } },
    },
    orderBy: { displayName: "asc" },
  });
  const intervals = await prisma.weeklyAvailability.findMany({
    where: {
      organizationId: business.id,
      weekday: weekdayForDate(date),
      staffId: null,
    },
  });
  const validTimes = generateTimeSlots(intervals, service.durationMinutes);
  if (!validTimes.includes(time)) {
    return response.status(404).json({ error: "Servicio u horario no disponible" });
  }
  const range = toAppointmentRange(date, time, service.durationMinutes);
  let appointment = null;

  for (const staff of eligibleStaff) {
    const conflict = await prisma.appointment.findFirst({
      where: {
        staffId: staff.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { lt: range.endAt },
        endAt: { gt: range.startAt },
      },
    });
    if (conflict) continue;

    const timeOff = await prisma.timeOff.findFirst({
      where: {
        organizationId: business.id,
        OR: [{ staffId: null }, { staffId: staff.id }],
        startAt: { lt: range.endAt },
        endAt: { gt: range.startAt },
      },
    });
    if (timeOff) continue;

    try {
      appointment = await prisma.appointment.create({
        data: {
          organizationId: business.id,
          serviceId: service.id,
          staffId: staff.id,
          startAt: range.startAt,
          endAt: range.endAt,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          status: "CONFIRMED",
          cancelToken: randomBytes(24).toString("hex"),
        },
        include: { service: true, staff: true, organization: true },
      });
    } catch (error) {
      if (!String(error).includes("appointment_no_staff_overlap")) throw error;
    }
    if (appointment) break;
  }

  if (!appointment) {
    return response.status(409).json({
      error: "Ese horario acaba de ocuparse. Elegí otra opción.",
    });
  }

  return response.status(201).json({
    data: {
      id: appointment.id,
      status: appointment.status,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      cancelToken: appointment.cancelToken,
      customer,
      service: appointment.service,
      staff: appointment.staff,
      business: appointment.organization,
    },
  });
});
