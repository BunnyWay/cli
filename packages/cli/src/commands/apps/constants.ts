import type { components } from "@bunny.net/api/generated/magic-containers.d.ts";

type ApplicationStatus = components["schemas"]["ApplicationStatus"];
type ApplicationRuntimeType = components["schemas"]["ApplicationRuntimeType"];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  Unknown: "Unknown",
  Active: "Active",
  Progressing: "Deploying",
  Inactive: "Inactive",
  Failing: "Failing",
  Suspended: "Suspended",
};

export const RUNTIME_LABELS: Record<ApplicationRuntimeType, string> = {
  Shared: "Shared",
  Reserved: "Reserved",
};
