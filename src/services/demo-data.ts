import { hashPassword } from "../auth/password.js";
import { prisma } from "../lib/prisma.js";

function futureDate(daysFromNow: number, hour: number, minutes = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hour + 3, minutes, 0, 0);
  return date;
}

export async function resetDemoData() {
  const passwordHash = await hashPassword("Demo1234!");

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(12011995) IS NULL AS "locked"',
    );

    const currentOrganization = await transaction.organization.findUnique({
      where: { slug: "norte-studio" },
      include: { memberships: { select: { userId: true } } },
    });
    const userIds = currentOrganization?.memberships.map(({ userId }) => userId) ?? [];

    if (currentOrganization) {
      await transaction.organization.delete({
        where: { id: currentOrganization.id },
      });
    }
    if (userIds.length > 0) {
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    }

    const organization = await transaction.organization.create({
      data: {
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

    const owner = await transaction.user.create({
      data: {
        id: "user_demo_owner",
        name: "Martina Norte",
        email: "admin@nortestudio.demo",
        passwordHash,
      },
    });

    await transaction.membership.create({
      data: {
        userId: owner.id,
        organizationId: organization.id,
        role: "OWNER",
      },
    });

    await transaction.service.createMany({
      data: [
        {
          id: "classic-cut",
          name: "Corte clásico",
          description: "Asesoramiento, corte a tijera o máquina y styling final.",
          durationMinutes: 40,
          priceInCents: 1250000,
          sortOrder: 1,
          organizationId: organization.id,
        },
        {
          id: "beard-design",
          name: "Diseño de barba",
          description: "Perfilado, toalla caliente y acabado con productos premium.",
          durationMinutes: 30,
          priceInCents: 900000,
          sortOrder: 2,
          organizationId: organization.id,
        },
        {
          id: "full-service",
          name: "Corte + barba",
          description: "La experiencia completa para renovar tu estilo.",
          durationMinutes: 70,
          priceInCents: 1950000,
          sortOrder: 3,
          organizationId: organization.id,
        },
        {
          id: "color-refresh",
          name: "Color refresh",
          description: "Cobertura sutil y tratamiento para un resultado natural.",
          durationMinutes: 55,
          priceInCents: 1800000,
          sortOrder: 4,
          organizationId: organization.id,
        },
      ],
    });

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
      await transaction.staff.create({
        data: {
          id: member.id,
          displayName: member.displayName,
          roleTitle: member.roleTitle,
          initials: member.initials,
          accent: member.accent,
          organizationId: organization.id,
          services: {
            create: member.serviceIds.map((serviceId) => ({ serviceId })),
          },
        },
      });
    }

    await transaction.weeklyAvailability.createMany({
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

    await transaction.appointment.createMany({
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
  });
}
