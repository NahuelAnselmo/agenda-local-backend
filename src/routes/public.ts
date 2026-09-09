import { randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  demoBusiness,
  demoServices,
  demoStaff,
  demoTimeSlots,
  hasConflict,
  reservedAppointments,
  toAppointmentRange,
} from "../data/demo.js";

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

publicRouter.get("/businesses/:slug", (request, response) => {
  if (request.params.slug !== demoBusiness.slug) {
    return response.status(404).json({ error: "Negocio no encontrado" });
  }

  return response.json({
    data: {
      ...demoBusiness,
      services: demoServices,
      staff: demoStaff,
    },
  });
});

publicRouter.get("/businesses/:slug/availability", (request, response) => {
  if (request.params.slug !== demoBusiness.slug) {
    return response.status(404).json({ error: "Negocio no encontrado" });
  }

  const parsed = availabilityQuery.safeParse(request.query);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Parámetros inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const service = demoServices.find(
    (item) => item.id === parsed.data.serviceId,
  );
  if (!service) {
    return response.status(404).json({ error: "Servicio no encontrado" });
  }

  const eligibleStaff = demoStaff.filter(
    (staff) =>
      staff.serviceIds.includes(service.id) &&
      (!parsed.data.staffId || staff.id === parsed.data.staffId),
  );

  const slots = demoTimeSlots.filter((time) => {
    const range = toAppointmentRange(
      parsed.data.date,
      time,
      service.durationMinutes,
    );
    return eligibleStaff.some(
      (staff) => !hasConflict(staff.id, range.startAt, range.endAt),
    );
  });

  return response.json({ data: { date: parsed.data.date, slots } });
});

publicRouter.post("/businesses/:slug/appointments", (request, response) => {
  if (request.params.slug !== demoBusiness.slug) {
    return response.status(404).json({ error: "Negocio no encontrado" });
  }

  const parsed = appointmentBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      error: "Datos de reserva inválidos",
      details: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const { serviceId, staffId, date, time, customer } = parsed.data;
  const service = demoServices.find((item) => item.id === serviceId);
  if (!service || !demoTimeSlots.includes(time)) {
    return response.status(404).json({ error: "Servicio u horario no disponible" });
  }

  const eligibleStaff = demoStaff.filter(
    (staff) =>
      staff.serviceIds.includes(service.id) &&
      (!staffId || staff.id === staffId),
  );
  const range = toAppointmentRange(date, time, service.durationMinutes);
  const assignedStaff = eligibleStaff.find(
    (staff) => !hasConflict(staff.id, range.startAt, range.endAt),
  );

  if (!assignedStaff) {
    return response.status(409).json({
      error: "Ese horario acaba de ocuparse. Elegí otra opción.",
    });
  }

  reservedAppointments.push({ staffId: assignedStaff.id, ...range });

  return response.status(201).json({
    data: {
      id: randomUUID(),
      status: "CONFIRMED",
      startAt: range.startAt.toISOString(),
      endAt: range.endAt.toISOString(),
      cancelToken: randomBytes(24).toString("hex"),
      customer,
      service,
      staff: assignedStaff,
      business: demoBusiness,
    },
  });
});
