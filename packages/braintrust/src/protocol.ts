import type * as API from "@distilled.cloud/core/api";
import {
  HTTP_STATUS_MAP,
  type API_ERRORS,
  type ConfigError,
  type InvalidInput,
} from "@distilled.cloud/core/errors";
import { makeRestProtocol, type RestErrorEnvelope } from "@distilled.cloud/core/protocol-rest";
import type { SdkError } from "@distilled.cloud/core/sdk-error";
/**
 * BraintrustProtocol -- the shared REST protocol instantiated for the
 * Braintrust API.
 *
 *   request:  credentials -> `Authorization: Bearer <key>` + API URL
 *             (default https://api.braintrust.dev), resolved from the calling
 *             fiber on every request
 *
 *   response: 2xx JSON is the payload; non-2xx `{ Code, Message }` bodies (or
 *             `text/plain` messages) map to the operation's typed error
 *             classes, then the shared HTTP-status classes (plus 402 ->
 *             PaymentRequired), then {@link UnknownBraintrustError}.
 */
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { Credentials, type Config } from "./credentials.ts";
import { BraintrustParseError, PaymentRequired, UnknownBraintrustError } from "./errors.ts";

/**
 * Error channel shared by every generated Braintrust operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * BraintrustOpError, BraintrustOpContext>` explicitly so the compiler never
 * infers these back out of the schema generics.
 */
export type BraintrustOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | UnknownBraintrustError
  | PaymentRequired
  | ConfigError
  | HttpClientError.HttpClientError
  | BraintrustParseError
  | InvalidInput
  | SdkError;

/** Context (requirements) shared by every generated Braintrust operation. */
export type BraintrustOpContext = Credentials | HttpClient.HttpClient;

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

// Braintrust spells the envelope keys in PascalCase, which core's default
// envelope (`code` / `message`) does not read.
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  const code = str(rec.Code);
  const message = str(rec.Message);
  if (code === undefined && message === undefined) return undefined;
  return { code, message };
};

/** Core's map plus 402, which Braintrust returns when the org is out of credits. */
const statusMap = { ...HTTP_STATUS_MAP, 402: PaymentRequired };

export const BraintrustProtocol: Layer.Layer<API.Protocol> = /*@__PURE__*/ makeRestProtocol<Config>(
  {
    // Resolved on the calling fiber per request, so a rotated key is picked
    // up without rebuilding the layer.
    credentials: /*@__PURE__*/ Effect.flatMap(Credentials, (resolve) => resolve),
    baseUrl: (creds) => creds.apiUrl,
    headers: (creds) => ({
      authorization: `Bearer ${Redacted.value(creds.apiKey)}`,
    }),
    errorEnvelope,
    statusMap,
    unknownError: ({ code, message, body }) =>
      new UnknownBraintrustError({
        code: typeof code === "string" ? code : code !== undefined ? String(code) : undefined,
        message,
        body,
      }),
    parseError: ({ body, cause }) => new BraintrustParseError({ body, cause }),
  },
);
