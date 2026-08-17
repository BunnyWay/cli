import type { AddDnsRecordModel, WriteRecordsResult } from "@bunny.net/actions";
import { writeRecords } from "@bunny.net/actions";
import prompts from "prompts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import type { CoreClient, DnsZoneModel } from "../api.ts";
import { recordName, recordTypeLabel } from "../record-types.ts";

export type {
  RecordWriteFailure,
  WriteRecordsResult,
} from "@bunny.net/actions";
export { writeRecords } from "@bunny.net/actions";

function describeRecord(r: AddDnsRecordModel): string {
  const head = `${recordTypeLabel(r.Type)}  ${recordName(r.Name) || "@"}`;
  const value = r.Value ? `  ${r.Value}` : "";
  const priority = r.Priority != null ? `  (priority ${r.Priority})` : "";
  return `${head}${value}${priority}`;
}

/**
 * Let the user pick which records to write (text mode; all pre-selected),
 * write them, then report. json serializes the applied/failed split; partial
 * failures warn per record; a total failure throws.
 */
export async function reviewAndApply(opts: {
  client: CoreClient;
  zone: DnsZoneModel;
  records: AddDnsRecordModel[];
  output: string;
  selectMessage: string;
  spinnerLabel: string;
  successFor: (added: number) => string;
  assumeYes?: boolean;
}): Promise<void> {
  const { client, zone, output } = opts;
  const interactive = output === "text";

  let chosen = opts.records;
  if (interactive && !opts.assumeYes) {
    const { picked } = await prompts({
      type: "multiselect",
      name: "picked",
      message: opts.selectMessage,
      choices: opts.records.map((r, i) => ({
        title: describeRecord(r),
        value: i,
        selected: true,
      })),
      hint: "Space to toggle, A to toggle all, Enter to confirm",
      instructions: false,
    });
    if (!picked || picked.length === 0) {
      logger.info("Nothing selected.");
      return;
    }
    chosen = (picked as number[])
      .map((i) => opts.records[i])
      .filter((r): r is AddDnsRecordModel => r != null);
  }

  const spin = interactive ? spinner(opts.spinnerLabel) : null;
  spin?.start();
  let result: WriteRecordsResult;
  try {
    result = await writeRecords(client, zone, chosen);
  } finally {
    spin?.stop();
  }
  const { applied, failures } = result;
  const allFailed = applied.length === 0 && failures.length > 0;

  if (output === "json") {
    logger.log(
      JSON.stringify(
        {
          applied,
          failures: failures.map((f) => ({
            record: f.record,
            error: f.message,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    if (applied.length > 0) logger.success(opts.successFor(applied.length));
    if (failures.length > 0) {
      logger.warn(`${failures.length} record(s) couldn't be added:`);
      for (const f of failures) {
        logger.warn(`  ${describeRecord(f.record)}: ${f.message}`);
      }
    }
  }

  // Exit nonzero (in both text and json) when nothing could be written.
  if (allFailed) {
    throw new UserError(
      `None of the ${failures.length} record(s) could be added to ${zone.Domain}.`,
      failures[0]?.message,
    );
  }
}
