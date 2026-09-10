import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/auth/password.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL es obligatoria");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function futureDate(daysFromNow: number, hour: number, minutes = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hour + 3, minutes, 0, 0);
  return date;
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "norte-studio" },
    update: {},
    create: {
      id: "org_norte_studio",
      name: "Norte Studio",
      slug: "norte-studio",
      category: "Barbería & cuidado personal",
      timezone: "America/Argentina/Buenos_Aires",
      currency: "ARS",
      address: "Honduras 4821",
      location: "Palermo, Buenos Aires",
      phone: "+54 11 5555-0194",
      email: "hola@nortestudio.demo",
      scheduleText: "Lun a sáb · 9:00 a 20:00",
      rating: 4.9,
      reviewCount: 128,
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: "admin@nortestudio.demo" },
    update: {},
    create: {
      id: "user_demo_owner",
      name: "Martina Norte",
      email: "admin@nortestudio.demo",
      passwordHash: await hashPassword("Demo1234!"),
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: owner.id,
        organizationId: organization.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      userId: owner.id,
      organizationId: organization.id,
      role: "OWNER",
    },
  });

  const services = [
    {
      id: "classic-cut",
      name: "Corte clásico",
      description: "Asesoramiento, corte a tijera o máquina y styling final.",
      durationMinutes: 40,
      priceInCents: 1250000,
      sortOrder: 1,
    },
    {
      id: "beard-design",
      name: "Diseño de barba",
      description: "Perfilado, toalla caliente y acabado con productos premium.",
      durationMinutes: 30,
      priceInCents: 900000,
      sortOrder: 2,
    },
    {
      id: "full-service",
      name: "Corte + barba",
      description: "La experiencia completa para renovar tu estilo.",
      durationMinutes: 70,
      priceInCents: 1950000,
      sortOrder: 3,
    },
    {
      id: "color-refresh",
      name: "Color refresh",
      description: "Cobertura sutil y tratamiento para un resultado natural.",
      durationMinutes: 55,
      priceInCents: 1800000,
      sortOrder: 4,
    },
  ];

  for (const service of services) {
    await prisma.service.upsert({
      where: { id: service.id },
      update: service,
      create: { ...service, organizationId: organization.id },
    });
  }

  const staffMembers = [
    {
      id: "nico-ramos",
      displayName: "Nico Ramos",
      roleTitle: "Barbero senior",
      initials: "NR",
      accent: "terracotta",
      serviceIds: ["classic-cut", "beard-design", "full-service"],
    },
    {
      id: "cami-sosa",
      displayName: "Cami Sosa",
      roleTitle: "Stylist & colorist",
      initials: "CS",
      accent: "sage",
      serviceIds: ["classic-cut", "full-service", "color-refresh"],
    },
    {
      id: "fran-lopez",
      displayName: "Fran López",
      roleTitle: "Barbero",
      initials: "FL",
      accent: "sand",
      serviceIds: ["classic-cut", "beard-design", "full-service"],
    },
  ];

  for (const member of staffMembers) {
    const staff = await prisma.staff.upsert({
      where: { id: member.id },
      update: {
        displayName: member.displayName,
        roleTitle: member.roleTitle,
        initials: member.initials,
        accent: member.accent,
      },
      create: {
        id: member.id,
        displayName: member.displayName,
        roleTitle: member.roleTitle,
        initials: member.initials,
        accent: member.accent,
        organizationId: organization.id,
      },
    });

    await prisma.staffService.deleteMany({ where: { staffId: staff.id } });
    await prisma.staffService.createMany({
      data: member.serviceIds.map((serviceId) => ({
        staffId: staff.id,
        serviceId,
      })),
    });
  }

  const staffAccessUser = await prisma.user.upsert({
    where: { email: "barbero@nortestudio.demo" },
    update: { name: "Nico Ramos" },
    create: {
      name: "Nico Ramos",
      email: "barbero@nortestudio.demo",
      passwordHash: await hashPassword("Barbero123!"),
    },
  });
  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: staffAccessUser.id,
        organizationId: organization.id,
      },
    },
    update: { role: "STAFF" },
    create: {
      userId: staffAccessUser.id,
      organizationId: organization.id,
      role: "STAFF",
    },
  });
  await prisma.staff.update({
    where: { id: "nico-ramos" },
    data: { userId: staffAccessUser.id },
  });

  if ((await prisma.weeklyAvailability.count()) === 0) {
    await prisma.weeklyAvailability.createMany({
      data: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        {
          weekday,
          startTime: "09:00",
          endTime: "13:00",
          organizationId: organization.id,
        },
        {
          weekday,
          startTime: "14:00",
          endTime: "20:00",
          organizationId: organization.id,
        },
      ]),
    });
  }

  if ((await prisma.appointment.count()) === 0) {
    await prisma.appointment.createMany({
      data: [
        {
          id: "appointment_demo_1",
          status: "CONFIRMED",
          startAt: futureDate(1, 10, 30),
          endAt: futureDate(1, 11, 10),
          customerName: "Sofía Méndez",
          customerEmail: "sofia@example.com",
          customerPhone: "11 4012 8890",
          cancelToken: "demo-cancel-token-1",
          organizationId: organization.id,
          serviceId: "classic-cut",
          staffId: "nico-ramos",
        },
        {
          id: "appointment_demo_2",
          status: "PENDING",
          startAt: futureDate(1, 14),
          endAt: futureDate(1, 15, 10),
          customerName: "Tomás Silva",
          customerEmail: "tomas@example.com",
          customerPhone: "11 3890 1250",
          cancelToken: "demo-cancel-token-2",
          organizationId: organization.id,
          serviceId: "full-service",
          staffId: "fran-lopez",
        },
        {
          id: "appointment_demo_3",
          status: "CONFIRMED",
          startAt: futureDate(2, 16, 15),
          endAt: futureDate(2, 17, 10),
          customerName: "Lucía Ferrer",
          customerEmail: "lucia@example.com",
          customerPhone: "11 5250 7743",
          cancelToken: "demo-cancel-token-3",
          organizationId: organization.id,
          serviceId: "color-refresh",
          staffId: "cami-sosa",
        },
      ],
    });
  }
}

main()
  .then(() => console.log("Datos ficticios cargados correctamente"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
