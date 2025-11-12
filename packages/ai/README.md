# @opencode/ai

Lightweight adapter layer that exposes the subset of the Vercel AI SDK used
inside `packages/opencode` while allowing the runtime implementation to be
swapped. The goal is to decouple the opencode agent logic from any single model
provider SDK so we can experiment with alternatives such as the Claude Agent
SDK.

## Design

- A small `AIAdapter` interface mirrors the `generateText`, `generateObject`,
  and `streamText` functions we already depend on.
- Concrete adapters live in `src/adapters/*`. The default adapter simply
  re-exports the Vercel AI SDK implementation, while other adapters can wrap
  different providers.
- `src/index.ts` re-exports all of the types and helper utilities we already
  import directly from `ai`, which keeps the rest of the codebase unchanged
  apart from the import path.

The active adapter is selected automatically using the
`OPENCODE_AI_ADAPTER` environment variable and can also be changed at runtime
via `setAIAdapter`.
