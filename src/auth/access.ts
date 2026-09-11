import type { Response } from "express";

export function staffScope(response: Response) {
  if (response.locals.auth.membership.role === "OWNER") return null;
  const profile = response.locals.auth.user.staffProfile;
  if (
    !profile ||
    profile.organizationId !== response.locals.auth.organization.id ||
    profile.archivedAt
  ) {
    return undefined;
  }
  return profile.id as string;
}
