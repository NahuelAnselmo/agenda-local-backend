import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

describe("API pública de reservas", () => {
  beforeEach(async () => {
    await prisma.appointment.deleteMany({
      where: { customerEmail: "cliente@example.com" },
    });
  });

  it("expone el negocio ficticio con servicios y profesionales", async () => {
    const response = await request(createApp()).get(
      "/api/v1/businesses/norte-studio",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.services).toHaveLength(4);
    expect(response.body.data.staff).toHaveLength(3);
  });

  it("evita reservar dos veces al mismo profesional y horario", async () => {
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

    const first = await request(createApp())
      .post("/api/v1/businesses/norte-studio/appointments")
      .send(booking);
    const duplicate = await request(createApp())
      .post("/api/v1/businesses/norte-studio/appointments")
      .send(booking);

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
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
