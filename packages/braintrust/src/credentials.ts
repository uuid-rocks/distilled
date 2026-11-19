/**
 * Braintrust credentials -- hand-written.
 *
 * The `Credentials` service resolves `{ apiKey, apiUrl }` per request; the
 * protocol sends the key as `Authorization: Bearer <key>` (the spec's
 * `bearerAuth` scheme). The env names match Braintrust's official SDK:
 * `BRAINTRUST_API_KEY`, and `BRAINTRUST_API_URL` for an organization whose
 * data plane is self-hosted (its `api_url` in `GET /v1/organization`).
 */
import * as EffectConfig from "@distilled.cloud/core/config";
import { ConfigError } from "@distilled.cloud/core/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

/** Braintrust's hosted API (the spec's `servers` entry). */
export const DEFAULT_API_URL = "https://api.braintrust.dev";

export interface Config {
  readonly apiKey: Redacted.Redacted<string>;
  /** API base URL, without a trailing slash. */
  readonly apiUrl: string;
}

export class Credentials
  extends /*@__PURE__*/ Context.Service<Credentials, Effect.Effect<Config, ConfigError>>()(
    "BraintrustCredentials",
  ) {}

const envConfig = /*@__PURE__*/ EffectConfig.all({
  apiKey: /*@__PURE__*/ EffectConfig.Redacted("BRAINTRUST_API_KEY"),
  apiUrl: /*@__PURE__*/ EffectConfig.String("BRAINTRUST_API_URL").pipe(
    /*@__PURE__*/ EffectConfig.withDefault(DEFAULT_API_URL),
  ),
});

/** Reads `BRAINTRUST_API_KEY` (required) and `BRAINTRUST_API_URL` (optional). */
export const CredentialsFromEnv: Layer.Layer<Credentials> = /*@__PURE__*/ Layer.succeed(
  Credentials,
  /*@__PURE__*/ envConfig.pipe(
    /*@__PURE__*/ Effect.map(({ apiKey, apiUrl }) => ({
      apiKey,
      apiUrl: apiUrl.replace(/\/+$/, ""),
    })),
    /*@__PURE__*/ Effect.mapError(
      () => new ConfigError({ message: "BRAINTRUST_API_KEY environment variable is required" }),
    ),
  ),
);

/** Credentials from a redacted API key and an optional API URL. */
export const fromApiKey = (config: {
  readonly apiKey: Redacted.Redacted<string>;
  readonly apiUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: config.apiKey,
      apiUrl: (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, ""),
    }),
  );
