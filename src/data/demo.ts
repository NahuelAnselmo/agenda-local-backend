export type DemoService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceInCents: number;
};

export type DemoStaff = {
  id: string;
  displayName: string;
  role: string;
  serviceIds: string[];
};

export const demoBusiness = {
  id: "norte-studio",
  slug: "norte-studio",
  name: "Norte Studio",
  category: "Barbería & cuidado personal",
  timezone: "America/Argentina/Buenos_Aires",
  currency: "ARS",
  address: "Honduras 4821",
  location: "Palermo, Buenos Aires",
  phone: "+54 11 5555-0194",
};

export const demoServices: DemoService[] = [
  {
    id: "classic-cut",
    name: "Corte clásico",
    description: "Asesoramiento, corte y styling final.",
    durationMinutes: 40,
    priceInCents: 1250000,
  },
  {
    id: "beard-design",
    name: "Diseño de barba",
    description: "Perfilado, toalla caliente y acabado premium.",
    durationMinutes: 30,
    priceInCents: 900000,
  },
  {
    id: "full-service",
    name: "Corte + barba",
    description: "La experiencia completa para renovar tu estilo.",
    durationMinutes: 70,
    priceInCents: 1950000,
  },
  {
    id: "color-refresh",
    name: "Color refresh",
    description: "Cobertura sutil y tratamiento de color.",
    durationMinutes: 55,
    priceInCents: 1800000,
  },
];

export const demoStaff: DemoStaff[] = [
  {
    id: "nico-ramos",
    displayName: "Nico Ramos",
    role: "Barbero senior",
    serviceIds: ["classic-cut", "beard-design", "full-service"],
  },
  {
    id: "cami-sosa",
    displayName: "Cami Sosa",
    role: "Stylist & colorist",
    serviceIds: ["classic-cut", "full-service", "color-refresh"],
  },
  {
    id: "fran-lopez",
    displayName: "Fran López",
    role: "Barbero",
    serviceIds: ["classic-cut", "beard-design", "full-service"],
  },
];

export const demoTimeSlots = [
  "09:00",
  "09:45",
  "10:30",
  "11:15",
  "12:00",
  "14:00",
  "14:45",
  "15:30",
  "16:15",
  "17:00",
  "17:45",
  "18:30",
];

export type ReservedAppointment = {
  staffId: string;
  startAt: Date;
  endAt: Date;
};

export const reservedAppointments: ReservedAppointment[] = [];

export function toAppointmentRange(
  date: string,
  time: string,
  durationMinutes: number,
) {
  const startAt = new Date(date + "T" + time + ":00-03:00");
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt };
}

export function hasConflict(
  staffId: string,
  startAt: Date,
  endAt: Date,
) {
  return reservedAppointments.some(
    (appointment) =>
      appointment.staffId === staffId &&
      appointment.startAt < endAt &&
      appointment.endAt > startAt,
  );
}
