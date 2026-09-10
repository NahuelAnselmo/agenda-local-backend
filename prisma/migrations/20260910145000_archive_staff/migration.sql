ALTER TABLE "Staff"
ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

CREATE INDEX "Staff_organizationId_archivedAt_idx"
ON "Staff"("organizationId", "archivedAt");
