import { Router } from "express";
import { z } from "zod";
import { staffScope } from "../../auth/access.js";
import { prisma } from "../../lib/prisma.js";
import { lockStaffSchedules } from "../../services/schedule-lock.js";

const timeOffBody = z
  .object({
    staffId: z.string().min(1).nullable().optional(),
    reason: z.string().trim().max(160).nullable().optional(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
  })
  .refine(({ startAt, endAt }) => new Date(startAt) < new Date(endAt), {
    message: "El fin debe ser posterior al inicio",
  });

export const timeOffRouter = Router();

timeOffRouter.get("/", async (_request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }

  const blocks = await prisma.timeOff.findMany({
    where: {
      organizationId,
      endAt: { gte: new Date() },
      ...(scopedStaffId
        ? { OR: [{ staffId: null }, { staffId: scopedStaffId }] }
        : {}),
    },
    include: { staff: true },
    orderBy: { startAt: "asc" },
  });

  return response.json({ data: blocks });
});

timeOffRouter.post("/", async (request, response) => {
  const parsed = timeOffBody.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Datos del bloqueo inválidos" });
  }

  const organizationId = response.locals.auth.organization.id as string;
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }
  if (scopedStaffId && parsed.data.staffId && parsed.data.staffId !== scopedStaffId) {
    return response.status(403).json({
      error: "Sólo podés bloquear horarios de tu propia agenda",
    });
  }

  const staffId = scopedStaffId ?? parsed.data.staffId ?? null;
  if (staffId) {
    const member = await prisma.staff.findFirst({
      where: { id: staffId, organizationId, active: true, archivedAt: null },
    });
    if (!member) {
      return response.status(400).json({ error: "Profesional no disponible" });
    }
  }

  const staffIds = staffId
    ? [staffId]
    : (
        await prisma.staff.findMany({
          where: { organizationId, active: true, archivedAt: null },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      ).map(({ id }) => id);
  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  const result = await prisma.$transaction(async (transaction) => {
    await lockStaffSchedules(transaction, organizationId, staffIds);
    const conflictCount = await transaction.appointment.count({
      where: {
        organizationId,
        staffId: { in: staffIds },
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (conflictCount > 0) return { conflictCount, block: null };

    const block = await transaction.timeOff.create({
      data: {
        organizationId,
        staffId,
        reason: parsed.data.reason || null,
        startAt,
        endAt,
      },
      include: { staff: true },
    });
    return { conflictCount: 0, block };
  });

  if (!result.block) {
    return response.status(409).json({
      error: "El bloqueo se superpone con turnos activos",
      conflictCount: result.conflictCount,
    });
  }

  return response.status(201).json({ data: result.block });
});

timeOffRouter.delete("/:id", async (request, response) => {
  const organizationId = response.locals.auth.organization.id as string;
  const scopedStaffId = staffScope(response);
  if (scopedStaffId === undefined) {
    return response.status(403).json({ error: "El acceso del profesional no está activo" });
  }

  const result = await prisma.timeOff.deleteMany({
    where: {
      id: String(request.params.id),
      organizationId,
      ...(scopedStaffId ? { staffId: scopedStaffId } : {}),
    },
  });
  if (result.count === 0) {
    return response.status(404).json({ error: "Bloqueo no encontrado" });
  }

  return response.status(204).send();
});
