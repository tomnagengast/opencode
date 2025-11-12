# SDK Wrapper - AI Module Imports

## Import Analysis

| Import Statement                                                                                                             | File Location                                   | Line |
|------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------|------|
| `import { LoadAPIKeyError } from "@opencode-ai/ai"`                                                                             | packages/opencode/src/acp/agent.ts             | 31   |
| `import { generateObject, type ModelMessage } from "@opencode-ai/ai"`                                                           | packages/opencode/src/agent/agent.ts           | 4    |
| `import { experimental_createMCPClient, type Tool } from "@opencode-ai/ai"`                                                     | packages/opencode/src/mcp/index.ts             | 1    |
| `import { NoSuchModelError, type LanguageModel, type SDK } from "@opencode-ai/ai"`                                              | packages/opencode/src/provider/provider.ts     | 5    |
| `import type { ModelMessage } from "@opencode-ai/ai"`                                                                           | packages/opencode/src/provider/transform.ts    | 1    |
| `import { streamText, type ModelMessage, type StreamTextResult, type Tool as AITool } from "@opencode-ai/ai"`                   | packages/opencode/src/session/compaction.ts    | 1    |
| `import { type LanguageModelUsage, type ProviderMetadata } from "@opencode-ai/ai"`                                              | packages/opencode/src/session/index.ts         | 3    |
| `import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "@opencode-ai/ai"`    | packages/opencode/src/session/message-v2.ts    | 5    |
| `import { generateText, streamText, type ModelMessage, tool, wrapLanguageModel, stepCountIs, jsonSchema } from "@opencode-ai/ai"` | packages/opencode/src/session/prompt.ts        | 13   |
| `import { generateText, type ModelMessage } from "@opencode-ai/ai"`                                                             | packages/opencode/src/session/summary.ts       | 5    |

## Summary

- All runtime calls now flow through the workspace-local `@opencode-ai/ai` adapter, enabling SDK swaps without touching downstream files.
- The adapter exports the subset of the Vercel AI SDK currently needed (generation helpers, tool wiring, error types, MCP helpers).
- Swapping providers will require implementations for `generateText`, `generateObject`, and `streamText` plus any provider-specific headers/options.

## Progress

### Completed
- Created the `packages/ai` workspace with a pluggable adapter interface and default Vercel AI SDK implementation.
- Added placeholder Claude and Codex adapters so we can wire in alternative SDKs incrementally.
- Updated every opencode consumer to import from `@opencode-ai/ai`, eliminating direct dependencies on the upstream `ai` package.
- Documented the new adapter surface in this spec and hooked the package into Turbo's `typecheck` pipeline to keep it verified.

### Next Steps
- Implement the real Claude adapter by mapping `@anthropic-ai/claude-agent-sdk`'s `query()` API onto the `generateText`/`generateObject`/`streamText` contract (including tool streaming and usage accounting).
- Define configuration for selecting adapters (env var + CLI hooks) and expose helper utilities for runtime switching.
- Expand tests/examples to cover both the default adapter and the Claude implementation once ready.
