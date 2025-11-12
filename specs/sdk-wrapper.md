# SDK Wrapper - AI Module Imports

## Import Analysis

| Import Statement                                                                                                | File Location            | Line |
|-----------------------------------------------------------------------------------------------------------------|--------------------------|------|
| `import { LoadAPIKeyError } from "ai"`                                                                          | acp/agent.ts             | 31   |
| `import type { ModelMessage } from "ai"`                                                                        | codex-tui.log            | 5928 |
| `import type { ModelMessage } from "ai"`                                                                        | codex-tui.log            | 6331 |
| `import { generateObject, type ModelMessage } from "ai"`                                                        | agent/agent.ts           | 4    |
| `import { experimental_createMCPClient, type Tool } from "ai"`                                                  | src/mcp/index.ts         | 1    |
| `import { NoSuchModelError, type LanguageModel, type Provider as SDK } from "ai"`                               | src/provider/provider.ts | 5    |
| `import type { ModelMessage } from "ai"`                                                                        | transform.ts             | 1    |
| `import { streamText, type ModelMessage, type StreamTextResult, type Tool as AITool } from "ai"`                | compaction.ts            | 1    |
| `import { type LanguageModelUsage, type ProviderMetadata } from "ai"`                                           | src/session/index.ts     | 3    |
| `import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"` | message-v2.ts            | 5    |
| `import { generateText, type ModelMessage } from "ai"`                                                          | summary.ts               | 5    |
| `import { generateObject, type ModelMessage } from "ai"`                                                        | sdk-wrapper.md           | 2    |
| `import type { ModelMessage } from "ai"`                                                                        | sdk-wrapper.md           | 3    |

## Summary

The codebase uses various exports from the "ai" module, with the most commonly
imported types being:

- `ModelMessage` (appears in 10+ imports)
- `LoadAPIKeyError` (error handling)
- Various generation functions (`generateObject`, `generateText`, `streamText`)
- Tool-related types and functions
- Provider and language model types
