import type { Plugin } from "@opencode-ai/plugin"
import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type ModelReasoningEffort,
  type RunResult,
  type SandboxMode,
  type Thread,
  type ThreadOptions,
} from "@openai/codex-sdk"
import type {
  JSONValue,
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import type { ModelMessage } from "ai"
import { randomUUID } from "crypto"

type CodexAgentInput = Partial<ThreadOptions> & Partial<CodexOptions>

type ProviderOverrides = Partial<ThreadOptions> & {
  threadID?: string
}

type AgentResult = {
  text: string
  usage: LanguageModelV2Usage
  metadata?: SharedV2ProviderMetadata
}

const PROVIDER_KEY = "codex-agent"
const ZERO_USAGE: LanguageModelV2Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
}
const DEFAULT_PROMPT = "Use the repository context to help the user."
const RELEASE = new Date().toISOString()

const model = (id: string, name: string) => ({
  id,
  name,
  releaseDate: RELEASE,
  attachment: true,
  reasoning: true,
  temperature: true,
  toolCall: true,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  limit: {
    context: 200_000,
    output: 8_192,
  },
  modalities: {
    input: ["text"],
    output: ["text"],
  },
  options: {},
})

export const ProviderCodexAgent: Plugin = async ({ providers, directory }) => {
  providers.register({
    id: PROVIDER_KEY,
    info: {
      id: PROVIDER_KEY,
      name: "Codex Agent SDK",
      env: ["CODEX_API_KEY"],
      models: {
        "gpt-5-codex": model("gpt-5-codex", "GPT 5 Codex"),
      },
    },
    loader: () => ({
      autoload: true,
      skipSDK: true,
      options: {
        workingDirectory: directory,
      },
      getModel: async (_sdk, modelID, options) => createCodexAgentLanguageModel(modelID, options),
    }),
  })
  return {}
}

function createCodexAgentLanguageModel(modelID: string, base: CodexAgentInput = {}): LanguageModelV2 {
  const normalized = normalizeBaseOptions(base, modelID)
  const codex = new Codex(normalized.client)

  return {
    specificationVersion: "v2",
    provider: PROVIDER_KEY,
    modelId: modelID,
    supportedUrls: {},
    async doGenerate(call) {
      const prompt = formatPrompt(call.prompt as ModelMessage[])
      const overrides = readProviderOverrides(call.providerOptions)
      const result = await runCodexTurn({
        codex,
        prompt,
        modelID,
        base: normalized.thread,
        overrides,
        call,
      })
      return {
        content: result.text ? [{ type: "text", text: result.text }] : [],
        finishReason: "stop",
        usage: result.usage,
        providerMetadata: result.metadata,
        warnings: [],
      }
    },
    async doStream(call) {
      const prompt = formatPrompt(call.prompt as ModelMessage[])
      const overrides = readProviderOverrides(call.providerOptions)
      const runner = runCodexTurn({
        codex,
        prompt,
        modelID,
        base: normalized.thread,
        overrides,
        call,
      })
      return {
        stream: buildStream(runner),
      }
    },
  }
}

function normalizeBaseOptions(input: CodexAgentInput, modelID: string) {
  return {
    client: normalizeClientOptions(input),
    thread: normalizeThreadOptions(input, modelID),
  }
}

function normalizeClientOptions(input: CodexAgentInput): CodexOptions {
  const client: CodexOptions = {}
  if (typeof input.baseUrl === "string" && input.baseUrl.length > 0) client.baseUrl = input.baseUrl
  if (typeof input.apiKey === "string" && input.apiKey.length > 0) client.apiKey = input.apiKey
  if (typeof input.codexPathOverride === "string" && input.codexPathOverride.length > 0)
    client.codexPathOverride = input.codexPathOverride
  return client
}

function normalizeThreadOptions(input: CodexAgentInput, modelID: string): ThreadOptions {
  return {
    model: input.model ?? modelID,
    sandboxMode: input.sandboxMode,
    workingDirectory: input.workingDirectory,
    skipGitRepoCheck: input.skipGitRepoCheck,
    modelReasoningEffort: input.modelReasoningEffort,
    networkAccessEnabled: input.networkAccessEnabled,
    webSearchEnabled: input.webSearchEnabled,
    approvalPolicy: input.approvalPolicy,
  }
}

function readProviderOverrides(options?: Record<string, Record<string, unknown>>) {
  const entry = options?.[PROVIDER_KEY]
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined
  const overrides: ProviderOverrides = {}
  if (typeof entry.threadID === "string" && entry.threadID.length > 0) overrides.threadID = entry.threadID
  if (typeof entry.model === "string" && entry.model.length > 0) overrides.model = entry.model
  if (isSandbox(entry.sandboxMode)) overrides.sandboxMode = entry.sandboxMode
  if (typeof entry.workingDirectory === "string" && entry.workingDirectory.length > 0)
    overrides.workingDirectory = entry.workingDirectory
  if (typeof entry.skipGitRepoCheck === "boolean") overrides.skipGitRepoCheck = entry.skipGitRepoCheck
  if (isReasoning(entry.modelReasoningEffort)) overrides.modelReasoningEffort = entry.modelReasoningEffort
  if (typeof entry.networkAccessEnabled === "boolean") overrides.networkAccessEnabled = entry.networkAccessEnabled
  if (typeof entry.webSearchEnabled === "boolean") overrides.webSearchEnabled = entry.webSearchEnabled
  if (isApproval(entry.approvalPolicy)) overrides.approvalPolicy = entry.approvalPolicy
  return overrides
}

async function runCodexTurn(args: {
  codex: Codex
  prompt: string
  modelID: string
  base: ThreadOptions
  overrides?: ProviderOverrides
  call: LanguageModelV2CallOptions
}): Promise<AgentResult> {
  const schema = readSchema(args.call)
  const merged = mergeThreadOptions(args.base, args.overrides, args.modelID)
  const thread = createThread(args.codex, merged, args.overrides?.threadID)
  const result = await thread.run(args.prompt || DEFAULT_PROMPT, schema ? { outputSchema: schema } : undefined)
  return {
    text: result.finalResponse ?? "",
    usage: convertUsage(result.usage),
    metadata: buildMetadata(thread, merged, result),
  }
}

function createThread(codex: Codex, options: ThreadOptions, threadID?: string) {
  if (threadID) return codex.resumeThread(threadID, options)
  return codex.startThread(options)
}

function mergeThreadOptions(base: ThreadOptions, overrides: ProviderOverrides | undefined, modelID: string) {
  const merged: ThreadOptions = {
    model: base.model ?? modelID,
    sandboxMode: base.sandboxMode,
    workingDirectory: base.workingDirectory,
    skipGitRepoCheck: base.skipGitRepoCheck,
    modelReasoningEffort: base.modelReasoningEffort,
    networkAccessEnabled: base.networkAccessEnabled,
    webSearchEnabled: base.webSearchEnabled,
    approvalPolicy: base.approvalPolicy,
  }
  if (!overrides) return merged
  if (typeof overrides.model === "string" && overrides.model.length > 0) merged.model = overrides.model
  if (isSandbox(overrides.sandboxMode)) merged.sandboxMode = overrides.sandboxMode
  if (typeof overrides.workingDirectory === "string" && overrides.workingDirectory.length > 0)
    merged.workingDirectory = overrides.workingDirectory
  if (typeof overrides.skipGitRepoCheck === "boolean") merged.skipGitRepoCheck = overrides.skipGitRepoCheck
  if (isReasoning(overrides.modelReasoningEffort)) merged.modelReasoningEffort = overrides.modelReasoningEffort
  if (typeof overrides.networkAccessEnabled === "boolean") merged.networkAccessEnabled = overrides.networkAccessEnabled
  if (typeof overrides.webSearchEnabled === "boolean") merged.webSearchEnabled = overrides.webSearchEnabled
  if (isApproval(overrides.approvalPolicy)) merged.approvalPolicy = overrides.approvalPolicy
  return merged
}

function convertUsage(usage: RunResult["usage"]) {
  if (!usage) return ZERO_USAGE
  const total = usage.input_tokens + usage.output_tokens
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: total,
    cachedInputTokens: usage.cached_input_tokens,
  }
}

function buildMetadata(thread: Thread, options: ThreadOptions, result: RunResult): SharedV2ProviderMetadata | undefined {
  const meta: Record<string, JSONValue> = {}
  if (thread.id) meta.thread_id = thread.id
  if (options.workingDirectory) meta.cwd = options.workingDirectory
  if (options.sandboxMode) meta.sandbox_mode = options.sandboxMode
  if (typeof options.networkAccessEnabled === "boolean") meta.network_access = options.networkAccessEnabled
  if (typeof options.webSearchEnabled === "boolean") meta.web_search = options.webSearchEnabled
  if (result.usage) {
    meta.usage = {
      input: result.usage.input_tokens,
      cached: result.usage.cached_input_tokens,
      output: result.usage.output_tokens,
    }
  }
  if (!Object.keys(meta).length) return undefined
  return {
    [PROVIDER_KEY]: meta,
  }
}

function buildStream(result: Promise<AgentResult>) {
  const textID = randomUUID()
  return new ReadableStream<LanguageModelV2StreamPart>({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] })
      controller.enqueue({ type: "text-start", id: textID })
      result
        .then((value) => {
          if (value.text) controller.enqueue({ type: "text-delta", id: textID, delta: value.text })
          controller.enqueue({ type: "text-end", id: textID })
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: value.usage,
            providerMetadata: value.metadata,
          })
          controller.close()
        })
        .catch((error) => {
          controller.enqueue({ type: "error", error })
          controller.close()
        })
    },
  })
}

function readSchema(call: LanguageModelV2CallOptions) {
  const format = call.responseFormat
  if (!format || typeof format !== "object") return undefined
  if ((format as Record<string, string>).type !== "json") return undefined
  return (format as Record<string, JSONValue>).schema
}

function formatPrompt(messages: ModelMessage[]) {
  if (!messages?.length) return ""
  const sys: string[] = []
  const turns: string[] = []
  for (const message of messages) {
    if (message.role === "system") {
      const content = typeof message.content === "string" ? message.content : renderSegments(message.content)
      if (content) sys.push(content)
      continue
    }
    const rendered = renderMessage(message)
    if (!rendered) continue
    const label = labelForRole(message.role)
    turns.push(`${label}:\n${rendered}`)
  }
  const parts: string[] = []
  if (sys.length) parts.push(`System:\n${sys.join("\n\n")}`)
  if (turns.length) parts.push(turns.join("\n\n"))
  return parts.join("\n\n")
}

function renderMessage(message: ModelMessage) {
  if (message.role === "system") {
    if (typeof message.content === "string") return message.content
    return renderSegments(message.content)
  }
  if (message.role === "tool" || message.role === "assistant" || message.role === "user")
    return renderSegments(message.content)
  return ""
}

function renderSegments(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts = content
    .map((part) => renderPart(part))
    .filter((text): text is string => Boolean(text))
  return parts.join("\n")
}

function renderPart(part: unknown) {
  if (!part || typeof part !== "object") return ""
  const chunk = part as Record<string, unknown>
  const type = typeof chunk.type === "string" ? chunk.type : ""
  if (type === "text" && typeof chunk.text === "string") return chunk.text
  if (type === "reasoning" && typeof chunk.text === "string") return chunk.text
  if (type === "tool-call") return `[Tool call ${stringifyValue(chunk.toolName)}]`
  if (type === "tool-result")
    return `[Tool result ${stringifyValue(chunk.toolName)}: ${stringifyValue(chunk.output ?? chunk.result)}]`
  if (type === "image") return "[Image]"
  if (type === "file") return "[File]"
  return ""
}

function stringifyValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}

function labelForRole(role: ModelMessage["role"]) {
  if (role === "user") return "User"
  if (role === "assistant") return "Assistant"
  if (role === "tool") return "Tool"
  return "Message"
}

function isSandbox(value: unknown): value is SandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
}

function isReasoning(value: unknown): value is ModelReasoningEffort {
  return value === "minimal" || value === "low" || value === "medium" || value === "high"
}

function isApproval(value: unknown): value is ApprovalMode {
  return value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted"
}
