/**
 * Braintrust pagination -- hand-written.
 *
 * Braintrust lists page by keyset: `starting_after` takes the `id` of the
 * last object of the previous page, and the `{ objects }` response carries
 * no next token. The POST `fetch` operations page by cursor instead:
 * `cursor` in, `cursor` out, null on the last page. Generated operations
 * dispatch on the trait's `mode` through core's strategies.
 */
export { paginateCursor, paginateKeyset } from "@distilled.cloud/core/pagination";
