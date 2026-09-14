ALTER TABLE "Appointment"
ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Appointment_organizationId_clientRequestId_key"
ON "Appointment"("organizationId", "clientRequestId");
