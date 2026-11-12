# @distilled.cloud/braintrust

Effect-native SDK for the [Braintrust](https://www.braintrust.dev) API, generated from Braintrust's
[OpenAPI description](https://github.com/braintrustdata/braintrust-openapi/blob/main/openapi/spec.json).

## Installation

```bash
npm install @distilled.cloud/braintrust effect
```

## Quick start

```ts
import { Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Braintrust from "@distilled.cloud/braintrust";

const program = Effect.gen(function* () {
  const project = yield* Braintrust.createProject({ name: "my-project" });

  const score = yield* Braintrust.createProjectScore({
    project_id: project.id,
    name: "accuracy",
    score_type: "slider",
  });

  const envVar = yield* Braintrust.createEnvVar({
    object_type: "project",
    object_id: project.id,
    name: "OPENAI_BASE_URL",
    value: Redacted.make("https://example.com/v1"),
  });

  const found = yield* Braintrust.getProject({ project_id: project.id });
  // Deleting a project leaves its env vars behind.
  yield* Braintrust.deleteEnvVar({ env_var_id: envVar.id });
  yield* Braintrust.deleteProject({ project_id: project.id });

  // A deleted (or never created) object fails with NotFoundOrForbidden.
  const gone = yield* Braintrust.getProject({ project_id: project.id }).pipe(
    Effect.as(false),
    Effect.catchTag("NotFoundOrForbidden", () => Effect.succeed(true)),
  );

  return { project: found.name, score: score.name, gone };
});

const Live = Layer.mergeAll(
  FetchHttpClient.layer,
  Braintrust.CredentialsFromEnv,
  Braintrust.BraintrustProtocol,
);

program.pipe(Effect.provide(Live), Effect.runPromise);
```

Every operation is on the package root: `createProject`, `listProjects`, `getProject`,
`updateProject`, `deleteProject`, and the same set for experiments, datasets, prompts, functions,
roles, groups, ACLs, project scores, tags, automations, views, AI secrets, env vars, MCP servers and
the rest. `PUT` routes ("create or replace") are `replace*`, and the `DELETE` routes that match by
body instead of id are `findAndDelete*`.

Lists page by keyset (`starting_after` is the last object's `id`), and the `fetch*Events`
operations page by cursor, so `.pages()` and `.items()` stream every page:

```ts
import * as Stream from "effect/Stream";

const projects = yield* Braintrust.listProjects.items({ limit: 100 }).pipe(Stream.runCollect);
```

Secrets are `Redacted`: AI secret and env var values on the way in, and env var and AI secret
previews, the one-time service token key, the temporary proxy credential and ingest key URLs (which
carry the key) on the way out.

## Auth

`BRAINTRUST_API_KEY` as `Authorization: Bearer`. `BRAINTRUST_API_URL` points it at a self-hosted
data plane (the organization's `api_url`) and defaults to `https://api.braintrust.dev`. Both names
match Braintrust's official SDK. To pass a key directly, use
`Braintrust.fromApiKey({ apiKey: Redacted.make(key) })`.

## Not supported

- **Streaming.** `invokeFunction`, `createEval` and the proxy operations answer with server-sent
  events when the request sets `stream: true`. Do not set it.
- **Proxy bodies are untyped.** The proxy operations forward an OpenAI-shaped request: pass its
  fields as the input (`createProxyChatCompletion({ model, messages })`), and read the response as
  `unknown`.

## Errors

Braintrust never answers 404 for a missing id. Depending on the resource and method it answers 400
or 403, as JSON `{ Code, Message }` or as plain text, with a message such as "Missing read access to
project id …, or the project does not exist". Every operation that addresses an object by id types
that as `NotFoundOrForbidden`. The same message comes back when the caller lacks access, so the class
covers both.

An organization out of credits gets `PaymentRequired` (402), which is not retried. Everything else
fails with the statuses the spec declares (`BadRequest`, `Forbidden`), then the shared HTTP status
classes, then `UnknownBraintrustError`.
