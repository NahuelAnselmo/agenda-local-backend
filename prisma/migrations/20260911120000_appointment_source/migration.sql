CREATE TYPE "AppointmentSource" AS ENUM ('WEB', 'WHATSAPP', 'PHONE', 'WALK_IN');

ALTER TABLE "Appointment"
ADD COLUMN "source" "AppointmentSource" NOT NULL DEFAULT 'WEB',
ALTER COLUMN "customerEmail" DROP NOT NULL;
