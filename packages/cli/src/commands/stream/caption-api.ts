import type { components } from "@bunny.net/openapi-client/generated/stream.d.ts";
import { UserError } from "@/core/errors.ts";
import type { StreamClient } from "./videos-api.ts";

export type CaptionModel = components["schemas"]["CaptionModel"];
export type CaptionValidationModel =
  components["schemas"]["CaptionValidationModel"];

export interface AddCaptionResult {
  /** Non-breaking issues the API found in an otherwise valid file. */
  warnings: string[];
  warningMessage?: string;
}

/**
 * Upload a caption file for one language.
 *
 * The API takes the file base64-encoded in the JSON body and validates it,
 * answering with a validation model: an invalid file is a hard failure listing
 * what is wrong, and a valid one may still carry warnings worth showing.
 */
export async function addVideoCaption(
  client: StreamClient,
  libraryId: number,
  videoId: string,
  srclang: string,
  captions: { label?: string; base64: string },
): Promise<AddCaptionResult> {
  const { data } = await client.POST(
    "/library/{libraryId}/videos/{videoId}/captions/{srclang}",
    {
      params: { path: { libraryId, videoId, srclang } },
      body: {
        srclang,
        label: captions.label,
        captionsFile: captions.base64,
      },
    },
  );

  const validation = data?.data;
  if (data?.success === false || validation?.valid === false) {
    const errors = validation?.errorList ?? [];
    throw new UserError(
      `The ${srclang} captions were rejected: ${data?.message ?? "invalid captions file"}`,
      errors.length > 0 ? errors.join("; ") : undefined,
    );
  }

  return {
    warnings: validation?.warningList ?? [],
    warningMessage: validation?.warningMessage ?? undefined,
  };
}

/** Delete the captions for one language. */
export async function deleteVideoCaption(
  client: StreamClient,
  libraryId: number,
  videoId: string,
  srclang: string,
): Promise<void> {
  const { data } = await client.DELETE(
    "/library/{libraryId}/videos/{videoId}/captions/{srclang}",
    { params: { path: { libraryId, videoId, srclang } } },
  );
  if (data && data.success === false) {
    throw new UserError(
      `Deleting the ${srclang} captions failed: ${data.message ?? "the request was rejected"}`,
    );
  }
}
