CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
ADD CONSTRAINT "appointment_no_staff_overlap"
EXCLUDE USING gist (
  "staffId" WITH =,
  tstzrange("startAt", "endAt", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED'));
