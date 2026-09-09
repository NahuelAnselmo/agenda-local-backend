import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

describe("API pública de reservas", () => {
  beforeEach(async () => {
    await prisma.appointment.deleteMany({
      where: { customerEmail: "cliente@example.com" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
});
