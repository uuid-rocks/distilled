/**
 * Braintrust-specific error types.
 *
 * Re-exports the shared HTTP status errors from core and adds the Braintrust
 * fallback and parse errors.
 *
 * Braintrust error bodies are `{ Code, Message }` with PascalCase keys, where
 * `Code` names the class (`ForbiddenError`, `BadRequestError`,
 * `NotFoundError`). Validation failures and auth failures come back as
 * `text/plain` instead; the text is the message.
 */
export {
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  Locked,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
  HTTP_STATUS_MAP,
  DEFAULT_ERRORS,
  API_ERRORS,
} from "@distilled.cloud/core/errors";
export type { DefaultErrors } from "@distilled.cloud/core/errors";
import * as Category from "@distilled.cloud/core/category";
import * as Schema from "@distilled.cloud/core/schema-lite-typed";

/**
 * Unknown Braintrust error -- returned when an error response matches neither
 * an operation's typed errors nor a shared HTTP status class.
 */
export class UnknownBraintrustError
  extends /*@__PURE__*/ Schema.TaggedError<UnknownBraintrustError>()("UnknownBraintrustError", {
    code: /*@__PURE__*/ Schema.optional(Schema.String),
    message: /*@__PURE__*/ Schema.optional(Schema.String),
    body: Schema.Unknown,
  }).pipe(Category.withServerError) {}

/**
 * 402 -- the organization is out of credits. Braintrust answers an event
 * insert with `{"Code":"HTTPError","Message":"Credit balance is exhausted
 * for logs. Add credits to resume."}` until credits are added, so it is not
 * retried. Without a class the status would fall to
 * {@link UnknownBraintrustError}, which the default policy retries.
 */
export class PaymentRequired
  extends /*@__PURE__*/ Schema.TaggedError<PaymentRequired>()("PaymentRequired", {
    message: Schema.String,
  }).pipe(Category.withQuotaError) {}

/** A 2xx response that does not match the operation's output schema. */
export class BraintrustParseError
  extends /*@__PURE__*/ Schema.TaggedError<BraintrustParseError>()("BraintrustParseError", {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  }).pipe(Category.withParseError) {}
