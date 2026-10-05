import { assertLanguages, streamLanguagesList } from "@bunny.net/tools/stream";
import type { ResolvedConfig } from "@/config/index.ts";
import { toolContext } from "@/core/tool-context.ts";
import { withSpinner } from "@/core/ui.ts";

/**
 * Check transcription output languages against the live list
 * (`GET /videolibrary/languages`) before anything is saved or billed, so new
 * languages work without a CLI release. A no-op for an empty list.
 */
export async function checkTranscribingLanguages(
  config: ResolvedConfig,
  codes: readonly string[] | null | undefined,
  verbose?: boolean,
): Promise<void> {
  if (!codes?.length) return;
  const languages = await withSpinner("Checking languages...", () =>
    streamLanguagesList.invoke(toolContext(config, { verbose }), {}),
  );
  assertLanguages(codes, languages, "transcribing");
}
