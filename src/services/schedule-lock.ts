import type { Prisma } from "../generated/prisma/client.js";

export async function lockStaffSchedules(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  staffIds: string[],
) {
  const orderedIds = [...new Set(staffIds)].sort();
  for (const staffId of orderedIds) {
    await transaction.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::int AS locked
      FROM pg_advisory_xact_lock(
        hashtext(${organizationId}),
        hashtext(${staffId})
      )
    `;
  }
}
