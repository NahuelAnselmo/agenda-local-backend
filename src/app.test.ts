import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { deliverWithResend, staffAccessEmail } from "./services/email.js";

describe("API pública de reservas", () => {
  beforeEach(async () => {
    const temporaryStaff = await prisma.staff.findMany({
      where: { displayName: "Barbero con Acceso" },
      select: { id: true },
    });
    const temporaryStaffIds = temporaryStaff.map(({ id }) => id);
    await prisma.appointment.deleteMany({
      where: {
        OR: [
          { customerEmail: "cliente@example.com" },
          { customerPhone: "telefono-demo" },
          { staffId: { in: temporaryStaffIds } },
        ],
      },
    });
    await prisma.staff.deleteMany({ where: { id: { in: temporaryStaffIds } } });
    await prisma.user.deleteMany({
      where: { email: "barbero.temporal@nortestudio.demo" },
    });
  });

  it("expone el negocio ficticio con servicios y profesionales", async () => {
    const response = await request(createApp()).get(
      "/api/v1/businesses/norte-studio",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.services.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        "classic-cut",
        "beard-design",
        "full-service",
        "color-refresh",
      ]),
    );
    expect(response.body.data.staff.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining(["nico-ramos", "cami-sosa", "fran-lopez"]),
    );
  });

  it("prepara y entrega por Resend las credenciales del profesional", async () => {
    const input = {
      recipientEmail: "barbero.temporal@nortestudio.demo",
      staffName: "Barbero Demo",
      businessName: "Norte Studio",
      temporaryPassword: "Temporal123!",
    };
    const content = staffAccessEmail(input);
    const requestMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const sent = await deliverWithResend(
      input,
      { apiKey: "re_test_key", from: "Agenda Demo <accesos@example.com>" },
      requestMock,
    );

    expect(sent).toBe(true);
    expect(content.loginUrl).toBe("http://localhost:3000/admin");
    expect(content.text).toContain(input.recipientEmail);
    expect(content.text).toContain(input.temporaryPassword);
    expect(requestMock).toHaveBeenCalledOnce();
    expect(requestMock.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
  });

  it("evita reservar dos veces al mismo profesional y horario", async () => {
    const app = createApp();
    const booking = {
      serviceId: "color-refresh",
      staffId: "cami-sosa",
      date: "2027-01-20",
      time: "10:30",
      customer: {
        name: "Cliente Demo",
        email: "cliente@example.com",
        phone: "1155550101",
      },
    };

    const first = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send(booking);
    const duplicate = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send(booking);

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
  });

  it("ofrece el mismo horario una vez por cada profesional disponible", async () => {
    const app = createApp();
    const appointment = {
      serviceId: "beard-design",
      date: "2027-04-03",
      time: "10:00",
      customer: {
        name: "Cliente Demo",
        email: "cliente@example.com",
        phone: "telefono-demo",
      },
    };

    const firstStaff = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({ ...appointment, staffId: "nico-ramos" });
    const secondStaff = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({ ...appointment, staffId: "fran-lopez" });
    const noCapacity = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({ ...appointment, staffId: null });

    expect(firstStaff.status).toBe(201);
    expect(secondStaff.status).toBe(201);
    expect(noCapacity.status).toBe(409);
  });

  it("detecta superposición aunque los turnos empiecen a distinta hora", async () => {
    const customer = {
      name: "Cliente Demo",
      email: "cliente@example.com",
      phone: "1155550101",
    };

    const first = await request(createApp())
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({
        serviceId: "full-service",
        staffId: "nico-ramos",
        date: "2027-01-20",
        time: "10:30",
        customer,
      });
    const overlapping = await request(createApp())
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({
        serviceId: "classic-cut",
        staffId: "nico-ramos",
        date: "2027-01-20",
        time: "11:00",
        customer,
      });

    expect(first.status).toBe(201);
    expect(overlapping.status).toBe(409);
  });

  it("impide reservar durante una ausencia del profesional", async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "norte-studio" },
    });
    const timeOff = await prisma.timeOff.create({
      data: {
        organizationId: organization.id,
        staffId: "fran-lopez",
        reason: "Ausencia de prueba",
        startAt: new Date("2027-02-06T12:00:00.000Z"),
        endAt: new Date("2027-02-06T20:00:00.000Z"),
      },
    });

    try {
      const booking = await request(createApp())
        .post("/api/v1/businesses/norte-studio/appointments")
        .send({
          serviceId: "classic-cut",
          staffId: "fran-lopez",
          date: "2027-02-06",
          time: "10:00",
          customer: {
            name: "Cliente Demo",
            email: "cliente@example.com",
            phone: "telefono-demo",
          },
        });

      expect(booking.status).toBe(409);
    } finally {
      await prisma.timeOff.delete({ where: { id: timeOff.id } });
    }
  });

  it("protege el dashboard y permite ingresar con el usuario demo", async () => {
    const app = createApp();
    const unauthorized = await request(app).get("/api/v1/admin/dashboard");
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");
    const dashboard = await request(app)
      .get("/api/v1/admin/dashboard")
      .set("Cookie", sessionCookie);

    expect(unauthorized.status).toBe(401);
    expect(login.status).toBe(200);
    expect(sessionCookie).toBeDefined();
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.services).toHaveLength(4);
  });

  it("actualiza las credenciales validando la contraseña actual", async () => {
    const app = createApp();
    const original = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@nortestudio.demo" },
    });
    const login = await request(app).post("/api/v1/auth/login").send({
      email: original.email,
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    try {
      const rejected = await request(app)
        .patch("/api/v1/auth/me/credentials")
        .set("Cookie", sessionCookie)
        .send({ currentPassword: "Incorrecta123", name: "Nombre rechazado" });
      expect(rejected.status).toBe(401);

      const updated = await request(app)
        .patch("/api/v1/auth/me/credentials")
        .set("Cookie", sessionCookie)
        .send({
          currentPassword: "Demo1234!",
          email: "propietario@nortestudio.demo",
          newPassword: "NuevaClave123!",
        });
      expect(updated.status).toBe(200);
      expect(updated.body.data.user.email).toBe("propietario@nortestudio.demo");

      const nextLogin = await request(app).post("/api/v1/auth/login").send({
        email: "propietario@nortestudio.demo",
        password: "NuevaClave123!",
      });
      expect(nextLogin.status).toBe(200);
    } finally {
      await prisma.user.update({
        where: { id: original.id },
        data: {
          name: original.name,
          email: original.email,
          passwordHash: original.passwordHash,
        },
      });
    }
  });

  it("crea profesionales y administra sus servicios asignados", async () => {
    const app = createApp();
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    const dashboard = await request(app)
      .get("/api/v1/admin/dashboard")
      .set("Cookie", sessionCookie);
    const serviceIds = dashboard.body.data.services
      .slice(0, 2)
      .map((service: { id: string }) => service.id) as string[];

    const created = await request(app)
      .post("/api/v1/admin/staff")
      .set("Cookie", sessionCookie)
      .send({
        displayName: "Alex Prueba",
        roleTitle: "Especialista",
        serviceIds,
      });

    try {
      expect(created.status).toBe(201);
      expect(created.body.data.initials).toBe("AP");
      expect(created.body.data.services).toHaveLength(2);

      const updated = await request(app)
        .patch("/api/v1/admin/staff/" + created.body.data.id)
        .set("Cookie", sessionCookie)
        .send({
          displayName: "Alex Demo",
          serviceIds: serviceIds.slice(0, 1),
        });

      expect(updated.status).toBe(200);
      expect(updated.body.data.initials).toBe("AD");
      expect(updated.body.data.services).toHaveLength(1);
    } finally {
      if (created.body.data?.id) {
        await prisma.staff.delete({ where: { id: created.body.data.id } });
      }
    }
  });

  it("archiva y restaura profesionales sin borrar su historial", async () => {
    const app = createApp();
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: "norte-studio" },
    });
    const member = await prisma.staff.create({
      data: {
        displayName: "Profesional Temporal",
        organizationId: organization.id,
      },
    });

    try {
      const archived = await request(app)
        .delete("/api/v1/admin/staff/" + member.id)
        .set("Cookie", sessionCookie);
      expect(archived.status).toBe(204);

      const stored = await prisma.staff.findUniqueOrThrow({
        where: { id: member.id },
      });
      expect(stored.active).toBe(false);
      expect(stored.archivedAt).not.toBeNull();

      const restored = await request(app)
        .post("/api/v1/admin/staff/" + member.id + "/restore")
        .set("Cookie", sessionCookie);
      expect(restored.status).toBe(200);
      expect(restored.body.data.archivedAt).toBeNull();
      expect(restored.body.data.active).toBe(true);
    } finally {
      await prisma.staff.delete({ where: { id: member.id } });
    }
  });

  it("da acceso individual y limita al profesional a su propia agenda", async () => {
    const app = createApp();
    const ownerLogin = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const ownerCookie = ownerLogin.headers["set-cookie"];
    if (!ownerCookie) throw new Error("La respuesta no creó una sesión");

    const created = await request(app)
      .post("/api/v1/admin/staff")
      .set("Cookie", ownerCookie)
      .send({
        displayName: "Barbero con Acceso",
        roleTitle: "Barbero",
        serviceIds: ["classic-cut"],
      });
    expect(created.status).toBe(201);
    const memberId = created.body.data.id as string;
    let accessUserId: string | undefined;

    try {
      const access = await request(app)
        .put("/api/v1/admin/staff/" + memberId + "/access")
        .set("Cookie", ownerCookie)
        .send({
          email: "barbero.temporal@nortestudio.demo",
          temporaryPassword: "Temporal123!",
        });
      expect(access.status).toBe(200);
      accessUserId = access.body.data.user.id;

      const booking = await request(app)
        .post("/api/v1/businesses/norte-studio/appointments")
        .send({
          serviceId: "classic-cut",
          staffId: memberId,
          date: "2027-03-05",
          time: "10:00",
          customer: {
            name: "Cliente Demo",
            email: "cliente@example.com",
            phone: "1155550101",
          },
        });
      expect(booking.status).toBe(201);

      const staffLogin = await request(app).post("/api/v1/auth/login").send({
        email: "barbero.temporal@nortestudio.demo",
        password: "Temporal123!",
      });
      const staffCookie = staffLogin.headers["set-cookie"];
      if (!staffCookie) throw new Error("La respuesta no creó una sesión");

      const dashboard = await request(app)
        .get("/api/v1/admin/dashboard")
        .set("Cookie", staffCookie);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.data.account.role).toBe("STAFF");
      expect(dashboard.body.data.account.staffId).toBe(memberId);
      expect(
        dashboard.body.data.appointments.every(
          (appointment: { staffId: string }) => appointment.staffId === memberId,
        ),
      ).toBe(true);

      const forbidden = await request(app)
        .patch("/api/v1/admin/business")
        .set("Cookie", staffCookie)
        .send({ name: "Cambio no autorizado" });
      expect(forbidden.status).toBe(403);
    } finally {
      await prisma.appointment.deleteMany({ where: { staffId: memberId } });
      await prisma.staff.delete({ where: { id: memberId } });
      if (accessUserId) {
        await prisma.user.delete({ where: { id: accessUserId } });
      }
    }
  });

  it("actualiza los datos públicos del negocio", async () => {
    const app = createApp();
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    const original = await prisma.organization.findUniqueOrThrow({
      where: { slug: "norte-studio" },
    });

    try {
      const updated = await request(app)
        .patch("/api/v1/admin/business")
        .set("Cookie", sessionCookie)
        .send({ address: "Dirección temporal 123", phone: "+54 11 4444-5555" });

      expect(updated.status).toBe(200);
      expect(updated.body.data.address).toBe("Dirección temporal 123");

      const publicBusiness = await request(app).get(
        "/api/v1/businesses/norte-studio",
      );
      expect(publicBusiness.body.data.phone).toBe("+54 11 4444-5555");
    } finally {
      await prisma.organization.update({
        where: { id: original.id },
        data: { address: original.address, phone: original.phone },
      });
    }
  });

  it("filtra la agenda por profesional, estado y cliente", async () => {
    const app = createApp();
    const booking = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({
        serviceId: "classic-cut",
        staffId: "fran-lopez",
        date: "2027-02-05",
        time: "12:00",
        customer: {
          name: "Cliente Demo",
          email: "cliente@example.com",
          phone: "1155550101",
        },
      });
    expect(booking.status).toBe(201);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    const agenda = await request(app)
      .get("/api/v1/admin/appointments")
      .query({
        staffId: "fran-lopez",
        status: "CONFIRMED",
        q: "Cliente Demo",
      })
      .set("Cookie", sessionCookie);

    expect(agenda.status).toBe(200);
    expect(agenda.body.data).toHaveLength(1);
    expect(agenda.body.data[0].customerEmail).toBe("cliente@example.com");
  });

  it("registra en la agenda un turno recibido por WhatsApp", async () => {
    const app = createApp();
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    const created = await request(app)
      .post("/api/v1/admin/appointments")
      .set("Cookie", sessionCookie)
      .send({
        serviceId: "classic-cut",
        staffId: "fran-lopez",
        date: "2027-02-05",
        time: "11:30",
        source: "WHATSAPP",
        customer: {
          name: "Cliente por WhatsApp",
          phone: "telefono-demo",
        },
        notes: "Prefiere corte con tijera",
      });

    expect(created.status).toBe(201);
    expect(created.body.data.source).toBe("WHATSAPP");
    expect(created.body.data.customerEmail).toBeNull();
    expect(created.body.data.notes).toBe("Prefiere corte con tijera");
  });

  it("permite crear, consultar y quitar un bloqueo de agenda", async () => {
    const app = createApp();
    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    const created = await request(app)
      .post("/api/v1/admin/time-off")
      .set("Cookie", sessionCookie)
      .send({
        staffId: "fran-lopez",
        reason: "Vacaciones",
        startAt: "2027-03-01T12:00:00.000Z",
        endAt: "2027-03-08T23:00:00.000Z",
      });
    const list = await request(app)
      .get("/api/v1/admin/time-off")
      .set("Cookie", sessionCookie);
    const removed = await request(app)
      .delete("/api/v1/admin/time-off/" + created.body.data.id)
      .set("Cookie", sessionCookie);

    expect(created.status).toBe(201);
    expect(created.body.data.staff.displayName).toBe("Fran López");
    expect(list.status).toBe(200);
    expect(
      list.body.data.some(({ id }: { id: string }) => id === created.body.data.id),
    ).toBe(true);
    expect(removed.status).toBe(204);
  });

  it("reprograma un turno validando servicio, profesional y horario", async () => {
    const app = createApp();
    const booking = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({
        serviceId: "classic-cut",
        staffId: "fran-lopez",
        date: "2027-02-05",
        time: "12:00",
        customer: {
          name: "Cliente Demo",
          email: "cliente@example.com",
          phone: "1155550101",
        },
      });
    expect(booking.status).toBe(201);

    const login = await request(app).post("/api/v1/auth/login").send({
      email: "admin@nortestudio.demo",
      password: "Demo1234!",
    });
    const sessionCookie = login.headers["set-cookie"];
    if (!sessionCookie) throw new Error("La respuesta no creó una sesión");

    const updated = await request(app)
      .patch("/api/v1/admin/appointments/" + booking.body.data.id)
      .set("Cookie", sessionCookie)
      .send({
        status: "CONFIRMED",
        schedule: {
          serviceId: "beard-design",
          staffId: "fran-lopez",
          date: "2027-02-05",
          time: "14:00",
        },
      });

    expect(updated.status).toBe(200);
    expect(updated.body.data.serviceId).toBe("beard-design");
    expect(updated.body.data.startAt).toBe("2027-02-05T17:00:00.000Z");
    expect(updated.body.data.endAt).toBe("2027-02-05T17:30:00.000Z");
  });

  it("permite consultar y cancelar una reserva mediante su enlace", async () => {
    const app = createApp();
    const booking = await request(app)
      .post("/api/v1/businesses/norte-studio/appointments")
      .send({
        serviceId: "classic-cut",
        staffId: "fran-lopez",
        date: "2027-01-22",
        time: "12:00",
        customer: {
          name: "Cliente Demo",
          email: "cliente@example.com",
          phone: "1155550101",
        },
      });
    const token = booking.body.data.cancelToken as string;
    const details = await request(app).get("/api/v1/appointments/" + token);
    const cancelled = await request(app).patch(
      "/api/v1/appointments/" + token + "/cancel",
    );

    expect(details.status).toBe(200);
    expect(details.body.data.customerName).toBe("Cliente Demo");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
  });
});
