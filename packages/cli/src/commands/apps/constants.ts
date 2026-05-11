import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";

type ApplicationStatus = components["schemas"]["ApplicationStatus"];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  unknown: "Unknown",
  active: "Active",
  progressing: "Deploying",
  inactive: "Inactive",
  failing: "Failing",
  suspended: "Suspended",
};
