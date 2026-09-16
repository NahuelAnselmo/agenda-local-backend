export function toAppointmentRange(
  date: string,
  time: string,
  durationMinutes: number,
) {
  const startAt = new Date(date + "T" + time + ":00-03:00");
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return { startAt, endAt };
}

const MAX_BOOKING_ADVANCE_MS = 366 * 24 * 60 * 60 * 1000;

export function isBookableStart(startAt: Date, now = new Date()) {
  const difference = startAt.getTime() - now.getTime();
  return difference > 0 && difference <= MAX_BOOKING_ADVANCE_MS;
}

export type AvailabilityInterval = {
  startTime: string;
  endTime: string;
};

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function minutesToTime(total: number) {
  const hours = Math.floor(total / 60).toString().padStart(2, "0");
  const minutes = (total % 60).toString().padStart(2, "0");
  return hours + ":" + minutes;
}

export function generateTimeSlots(
  intervals: AvailabilityInterval[],
  durationMinutes: number,
) {
  return intervals.flatMap((interval) => {
    const start = timeToMinutes(interval.startTime);
    const end = timeToMinutes(interval.endTime);
    const slots: string[] = [];

    for (let minute = start; minute + durationMinutes <= end; minute += 30) {
      slots.push(minutesToTime(minute));
    }
    return slots;
  });
}

export function weekdayForDate(date: string) {
  return new Date(date + "T12:00:00-03:00").getUTCDay();
}
