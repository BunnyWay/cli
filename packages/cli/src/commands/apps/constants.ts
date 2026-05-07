import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";

type ApplicationStatus = components["schemas"]["ApplicationStatus"];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  Unknown: "Unknown",
  Active: "Active",
  Progressing: "Deploying",
  Inactive: "Inactive",
  Failing: "Failing",
  Suspended: "Suspended",
};
