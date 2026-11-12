#!/usr/bin/env -S node --conditions=bun
/**
 * convert — Braintrust's OpenAPI description → a Smithy JSON model in
 * .generated-specs.
 *
 * Input:  specs/spec-mirror-braintrust/specs/openapi.json
 *         patches/*.json  (RFC-6902 patches to the Smithy model)
 * Output: .generated-specs/braintrust.json
 *
 * Braintrust publishes ONE OpenAPI 3.1 document. Every operation lands in one
 * module, so `Braintrust.createProject` sits beside `Braintrust.listProjects`.
 * Two spec-derived steps run around the shared OpenAPI→Smithy conversion:
 *
 *   1. Names come from the route. Upstream ids restate method and path
 *      (`getProject` lists projects, `getProjectId` gets one), so the
 *      verbNoun heuristic would give the list and the get the same name.
 *      {@link operationName} names every operation from its route instead.
 *   2. Lists are stamped `smithy.api#paginated`. A GET with a
 *      `starting_after` query parameter and an `objects` array pages by
 *      keyset (the next page starts after the last object's `id`; the
 *      response has no token), and
 *      a `cursor` in the request body with a `cursor` beside an `events`
 *      array in the response pages by cursor. Both are read off the
 *      OpenAPI operation, so an endpoint that stops paging upstream stops
 *      being stamped.
 *
 * Then `finalizeConvert` applies the patches and the names.
 * `scripts/generate.ts` compiles the model into src/services.
 */
import * as path from "node:path";
import { readModel, writeModel } from "@distilled.cloud/dev/codegen/models";
import { runOpenApiConvert } from "@distilled.cloud/dev/codegen/openapi-cli";
import { finalizeConvert } from "@distilled.cloud/dev/codegen/patches";
import {
  pathToVerbNoun,
  type OperationIdContext,
} from "@distilled.cloud/dev/codegen/rewrite-operation-ids";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, ".generated-specs");
const NAME = "braintrust";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** The document, captured by `preprocess` for the naming and pagination rules. */
let spec: any;

/** Resolve `$ref`s against the document. */
const deref = (node: any): any => {
  let n = node;
  while (typeof n?.$ref === "string" && n.$ref.startsWith("#/")) {
    n = n.$ref
      .slice(2)
      .split("/")
      .reduce((o: any, k: string) => o?.[k], spec);
  }
  return n;
};

const jsonSchema = (content: any): any => deref(content?.["application/json"]?.schema);
const responseSchema = (op: any): any => jsonSchema(op.responses?.["200"]?.content);
const bodySchema = (op: any): any => jsonSchema(deref(op.requestBody)?.content);
const hasArray = (schema: any, member: string): boolean =>
  deref(schema?.properties?.[member])?.type === "array";

const isParam = (seg: string): boolean => seg.startsWith("{");
/** A greedy label (`{path+}`) is a path suffix, not a member id. */
const isGreedy = (seg: string): boolean => /^\{[^}]+\+\}$/.test(seg);

const pascal = (snake: string): string =>
  snake
    .split("_")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

/** Pluralise the last word of a PascalCase noun (`ApiKey` → `ApiKeys`). */
const plural = (noun: string): string =>
  noun.endsWith("s") ? noun : /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;

/** A collection-level action segment: one with a verb in it (`batch_update`, `list_org`). */
const ACTION_VERBS = new Set(["list", "get", "create", "update", "delete"]);
const actionVerb = (seg: string): string | undefined => {
  const tokens = seg.split("_");
  if (tokens.length < 2 || !tokens.some((t) => ACTION_VERBS.has(t))) return undefined;
  const [first, ...rest] = tokens;
  return first! + pascal(rest.join("_"));
};

/**
 * Name an operation from its route (step 1). Built on core's
 * {@link pathToVerbNoun} (`POST /v1/project` → `createProject`), with the
 * Braintrust route shapes it does not know:
 *
 *   GET    /v1/x               → listXs       (the 200 is `{ objects }` or an array)
 *   PUT    /v1/x               → replaceX     ("Create or replace")
 *   DELETE /v1/x               → findAndDeleteX (deletes the one the body matches)
 *   *      /v1/x/<verb_noun>   → <verbNoun>Xs (`batch_update` → batchUpdateAcls)
 *   GET    /v1/x/{id}/<action> → <action>X    (`summarize` → summarizeExperiment)
 *   *      /v1/x/{id}/<action> on events → <action>XEvents, getXEvents for the GET
 *   POST   /v1/x/{path+}       → createX      (a greedy label is not a member id)
 *   POST   /v1/<verb>          → <verb><Tag>  (the route names no resource)
 *
 * The names match the official SDK's methods (`list`, `replace`,
 * `findAndDelete`, `summarize`).
 */
const operationName = (_operationId: string, ctx: OperationIdContext): string => {
  const op = spec.paths[ctx.path][ctx.method];
  const method = ctx.method.toLowerCase();
  const segments = ctx.path.split("/").filter(Boolean);
  const routed = segments.some(isGreedy)
    ? `/${segments.filter((s) => !isGreedy(s)).join("/")}`
    : ctx.path;
  const routeCtx = { path: routed, method: segments.some(isGreedy) ? "post" : ctx.method };
  const response = responseSchema(op);
  const returnsCollection = response?.type === "array" || hasArray(response, "objects");
  const base = pathToVerbNoun(routeCtx, { returnsCollection });

  const literals = routed.split("/").filter((s) => s && s !== "v1" && !isParam(s));
  const resource = literals[0];
  const last = routed.split("/").filter(Boolean).at(-1)!;
  const memberAction = segments.length >= 3 && segments.some(isParam) && !isParam(last);

  // `/v1/x/<verb_noun>`: the verb is in the segment, the noun is the collection.
  const verb = literals.length === 2 ? actionVerb(literals[1]!) : undefined;
  if (verb !== undefined && resource !== undefined) return verb + plural(pascal(resource));

  if (memberAction && resource !== undefined) {
    const action = literals.slice(1);
    const noun = pathToVerbNoun({ path: `/${resource}/{id}`, method: "get" }).slice("get".length);
    if (hasArray(bodySchema(op), "events") || hasArray(response, "events")) {
      return `${method === "get" ? "get" : action[0]}${noun}Events`;
    }
    if (method === "get") return action[0] + noun;
    return base;
  }

  const atCollection = !isParam(segments.at(-1)!) && !segments.some(isGreedy);
  if (method === "get" && returnsCollection) return `list${plural(base.slice("list".length))}`;
  if (method === "put" && atCollection) return `replace${base.slice("put".length)}`;
  if (method === "delete" && atCollection) return `findAndDelete${base.slice("delete".length)}`;
  // A bare verb (`/v1/insert` → `insert`) names no resource; the tag does.
  if (/^[a-z]+$/.test(base) && literals.length === 1) {
    return base + pascal(String(op.tags?.[0] ?? "").replace(/\s+/g, "_"));
  }
  return base;
};

/** The `smithy.api#paginated` trait for one operation, or undefined (step 2). */
const paginationFor = (method: string, op: any): Record<string, string> | undefined => {
  const query = new Set(
    (op.parameters ?? [])
      .map(deref)
      .filter((p: any) => p?.in === "query")
      .map((p: any) => p.name),
  );
  const response = responseSchema(op);
  // A bare-array page (`GET /v1/acl/list_org`) is not stamped: core's items
  // path cannot address the response root.
  if (method === "get" && query.has("starting_after")) {
    if (!hasArray(response, "objects")) return undefined;
    return {
      mode: "keyset",
      inputToken: "starting_after",
      outputToken: "id",
      items: "objects",
      ...(query.has("limit") ? { pageSize: "limit" } : {}),
    };
  }
  const body = bodySchema(op);
  if (body?.properties?.cursor !== undefined && response?.properties?.cursor !== undefined) {
    if (!hasArray(response, "events")) return undefined;
    return {
      mode: "cursor",
      inputToken: "cursor",
      outputToken: "cursor",
      items: "events",
      ...(body.properties.limit !== undefined ? { pageSize: "limit" } : {}),
    };
  }
  return undefined;
};

await runOpenApiConvert({
  root,
  specs: [
    {
      name: NAME,
      specPath: "specs/spec-mirror-braintrust/specs/openapi.json",
      preprocess: (doc) => {
        spec = doc;
      },
    },
  ],
  patchesDir: "patches",
  finalize: false,
  options: {
    namespace: "com.braintrust",
    serviceName: "Braintrust",
    operationNames: operationName,
  },
});

const modelPath = path.join(outDir, `${NAME}.json`);
const model = readModel(modelPath);

const byRoute = new Map<string, Record<string, string>>();
for (const [route, item] of Object.entries<any>(spec.paths)) {
  for (const method of HTTP_METHODS) {
    const op = item[method];
    if (!op) continue;
    const trait = paginationFor(method, op);
    if (trait) byRoute.set(`${method.toUpperCase()} ${route}`, trait);
  }
}

let stamped = 0;
for (const shape of Object.values<any>(model.shapes)) {
  if (shape?.type !== "operation") continue;
  const http = shape.traits?.["smithy.api#http"];
  const trait = http ? byRoute.get(`${http.method} ${http.uri}`) : undefined;
  if (!trait) continue;
  shape.traits["smithy.api#paginated"] = trait;
  stamped++;
}
// Every paginated route must land on an operation; a miss means the uri no
// longer round-trips and the SDK would silently lose `.pages()`.
if (stamped !== byRoute.size) {
  throw new Error(
    `${byRoute.size} paginated route(s) detected but ${stamped} stamped — ` +
      `an operation's http uri no longer matches its OpenAPI path`,
  );
}
writeModel(modelPath, model);
console.log(`🔗 stamped ${stamped} paginated operation(s)`);

await finalizeConvert({
  root,
  patchesFor: () => "",
  // The converter computed the names; finalize only applies them.
  operationNaming: "as-is",
});
