import type { Plugin } from "@opencode-ai/plugin"
import { query, type Options as AgentOptions, type SDKAssistantMessage, type SDKPartialAssistantMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk"
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

type AgentOptionInput = Partial<AgentOptions>

type AgentResult = {
  text: string
  usage: LanguageModelV2Usage
  metadata?: SharedV2ProviderMetadata
}

const PROVIDER_ID = "anthropic-agent"
const RELEASE = new Date().toISOString()
const ZERO_USAGE: LanguageModelV2Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

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

export const ProviderClaudeAgent: Plugin = async ({ providers, directory }) => {
  providers.register({
    id: PROVIDER_ID,
    info: {
      id: PROVIDER_ID,
      name: "Claude Agent SDK",
      env: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_AUTH_TOKEN"],
      models: {
        sonnet: model("sonnet", "Claude Agent Sonnet"),
        opus: model("opus", "Claude Agent Opus"),
        haiku: model("haiku", "Claude Agent Haiku"),
      },
    },
    loader: () => ({
      autoload: false,
      skipSDK: true,
      options: {
        cwd: directory,
      },
      getModel: async (_sdk, modelID, options) => createAnthropicAgentLanguageModel(modelID, options),
    }),
  })
  return {}
}

function createAnthropicAgentLanguageModel(modelID: string, base: AgentOptionInput = {}): LanguageModelV2 {
  const normalizedBase = normalizeAgentOptions(base)

  return {
    specificationVersion: "v2",
    provider: PROVIDER_ID,
    modelId: modelID,
    supportedUrls: {},
    async doGenerate(call) {
      const prompt = formatPrompt(call.prompt as ModelMessage[])
      const result = await executeAgentQuery(prompt, modelID, normalizedBase, call)
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
      const runner = executeAgentQuery(prompt, modelID, normalizedBase, call)
      const stream = buildResultStream(runner)
      return {
        stream,
        request: {
          body: {
            prompt,
          },
        },
      }
    },
  }
}

function executeAgentQuery(
  prompt: string,
  modelID: string,
  base: AgentOptionInput,
  call: LanguageModelV2CallOptions,
): Promise<AgentResult> {
  const overrides = readProviderOverrides(call.providerOptions)
  const merged = mergeAgentOptions(base, overrides)
  const prepared = prepareCallOptions(modelID, merged)
  const controller = new AbortController()
  if (call.abortSignal?.aborted) controller.abort()
  if (call.abortSignal) call.abortSignal.addEventListener("abort", () => controller.abort(), { once: true })
  const finalPrompt = prompt || "Use the repository context to help the user."
  return consumeAgentQuery(finalPrompt, {
    ...prepared,
    abortController: controller,
  })
}

function consumeAgentQuery(prompt: string, options: AgentOptions): Promise<AgentResult> {
  const iterator = query({ prompt, options })
  const state = {
    chunks: [] as string[],
    usage: ZERO_USAGE,
    sessionID: undefined as string | undefined,
    result: undefined as SDKResultMessage | undefined,
  }

  const collect = async () => {
    for await (const message of iterator) {
      if (message.type === "stream_event") {
        const delta = extractStreamText(message)
        if (delta) state.chunks.push(delta)
        continue
      }
      if (message.type === "assistant") {
        state.sessionID = message.session_id
        const text = extractAssistantText(message)
        if (text) state.chunks.push(text)
        continue
      }
      if (message.type === "result") {
        state.usage = convertUsage(message)
        state.result = message
      }
    }

    const metadata = buildMetadata(state.sessionID, state.result)
    return {
      text: state.chunks.join(""),
      usage: state.usage,
      metadata,
    }
  }

  return collect()
}

function buildResultStream(result: Promise<AgentResult>) {
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

function prepareCallOptions(modelID: string, options: AgentOptionInput): AgentOptionInput {
  const prepared = { ...options }
  const mapped = options.model ?? mapAgentModel(modelID)
  if (mapped) prepared.model = mapped
  return prepared
}

function mapAgentModel(modelID: string) {
  if (modelID.includes("haiku")) return "haiku"
  if (modelID.includes("opus")) return "opus"
  if (modelID.includes("sonnet")) return "sonnet"
  return "inherit"
}

function formatPrompt(messages: ModelMessage[]): string {
  if (!messages || messages.length === 0) return ""
  const system: string[] = []
  const turns: string[] = []

  for (const message of messages) {
    if (message.role === "system") {
      const content = typeof message.content === "string" ? message.content : renderSegments(message.content)
      if (content) system.push(content)
      continue
    }

    const rendered = renderMessageContent(message)
    if (!rendered) continue
    const label = labelForRole(message.role)
    turns.push(`${label}:\n${rendered}`)
  }

  const parts: string[] = []
  if (system.length > 0) parts.push(`System:\n${system.join("\n\n")}`)
  if (turns.length > 0) parts.push(turns.join("\n\n"))
  return parts.join("\n\n")
}

function renderMessageContent(message: ModelMessage) {
  if (message.role === "system") {
    return typeof message.content === "string" ? message.content : renderSegments(message.content)
  }
  if (message.role === "tool") return renderSegments(message.content)
  if (message.role === "user") return renderSegments(message.content)
  if (message.role === "assistant") return renderSegments(message.content)
  return ""
}

function renderSegments(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts = content
    .map((part) => renderPart(part))
    .filter((text): text is string => Boolean(text))
  return parts.join("\n")
}

function renderPart(part: unknown) {
  if (!part || typeof part !== "object") return ""
  const record = part as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : ""
  if (type === "text" && typeof record.text === "string") return record.text
  if (type === "reasoning" && typeof record.text === "string") return record.text
  if (type === "tool-call") return `[Tool call ${stringifyValue(record.toolName)}]`
  if (type === "tool-result") return `[Tool result ${stringifyValue(record.toolName)}: ${stringifyValue(record.output)}]`
  if (type === "image") return "[Image omitted]"
  if (type === "file") return "[File attachment]"
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

function extractAssistantText(message: SDKAssistantMessage) {
  const content = message.message.content
  if (!Array.isArray(content)) return ""
  const parts = content
    .map((part) => renderPart(part))
    .filter((text): text is string => Boolean(text))
  return parts.join("")
}

function extractStreamText(message: SDKPartialAssistantMessage) {
  const event = message.event
  if (!event || typeof event !== "object") return ""
  const record = event as Record<string, unknown>
  const type = record["type"]
  if (type !== "content_block_delta") return ""
  const deltaValue = record["delta"]
  if (!deltaValue || typeof deltaValue !== "object") return ""
  const delta = deltaValue as Record<string, unknown>
  const deltaType = delta["type"]
  if (deltaType !== "text_delta") return ""
  const text = delta["text"]
  if (typeof text !== "string") return ""
  return text
}

function convertUsage(message: SDKResultMessage): LanguageModelV2Usage {
  const usage = message.usage as Record<string, unknown>
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0
  const total = typeof usage.total_tokens === "number" ? usage.total_tokens : input + output
  const reasoning = typeof usage.thinking_tokens === "number" ? usage.thinking_tokens : undefined
  const cached = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    reasoningTokens: reasoning,
    cachedInputTokens: cached,
  }
}

function buildMetadata(sessionID?: string, result?: SDKResultMessage): SharedV2ProviderMetadata | undefined {
  if (!sessionID && !result) return undefined
  const metadata: Record<string, JSONValue> = {}
  if (sessionID) metadata.session_id = sessionID
  if (result) {
    metadata.turns = result.num_turns
    metadata.duration_ms = result.duration_ms
    metadata.cost_usd = result.total_cost_usd
  }
  return {
    [PROVIDER_ID]: metadata,
  }
}

function readProviderOverrides(options?: Record<string, Record<string, unknown>>) {
  if (!options) return {}
  const entry = options[PROVIDER_ID]
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {}
  return normalizeAgentOptions(entry as AgentOptionInput)
}

function mergeAgentOptions(base: AgentOptionInput, overrides: AgentOptionInput) {
  if (!Object.keys(overrides).length) return base
  const env = mergeRecords(base.env, overrides.env)
  const additionalDirectories = overrides.additionalDirectories ?? base.additionalDirectories
  const allowedTools = overrides.allowedTools ?? base.allowedTools
  const disallowedTools = overrides.disallowedTools ?? base.disallowedTools
  const executableArgs = overrides.executableArgs ?? base.executableArgs
  const plugins = overrides.plugins ?? base.plugins
  const extraArgs = overrides.extraArgs ?? base.extraArgs
  return {
    ...base,
    ...overrides,
    env,
    additionalDirectories,
    allowedTools,
    disallowedTools,
    executableArgs,
    plugins,
    extraArgs,
  }
}

function mergeRecords(
  base?: Record<string, string | undefined>,
  overrides?: Record<string, string | undefined>,
) {
  if (!base && !overrides) return undefined
  const result: Record<string, string | undefined> = {}
  if (base) {
    for (const key of Object.keys(base)) {
      result[key] = base[key]
    }
  }
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      result[key] = overrides[key]
    }
  }
  return result
}

function normalizeAgentOptions(input: AgentOptionInput): AgentOptionInput {
  if (!input || typeof input !== "object") return {}
  const result: AgentOptionInput = {}
  if (typeof input.cwd === "string" && input.cwd.length > 0) result.cwd = input.cwd
  if (typeof input.resume === "string" && input.resume.length > 0) result.resume = input.resume
  if (typeof input.resumeSessionAt === "string" && input.resumeSessionAt.length > 0)
    result.resumeSessionAt = input.resumeSessionAt
  if (typeof input.permissionMode === "string" && input.permissionMode.length > 0)
    result.permissionMode = input.permissionMode
  if (typeof input.fallbackModel === "string" && input.fallbackModel.length > 0)
    result.fallbackModel = input.fallbackModel
  if (typeof input.model === "string" && input.model.length > 0) result.model = input.model
  if (typeof input.maxThinkingTokens === "number") result.maxThinkingTokens = input.maxThinkingTokens
  if (typeof input.maxTurns === "number") result.maxTurns = input.maxTurns
  if (typeof input.maxBudgetUsd === "number") result.maxBudgetUsd = input.maxBudgetUsd
  if (typeof input.includePartialMessages === "boolean") result.includePartialMessages = input.includePartialMessages
  if (typeof input["continue"] === "boolean") result["continue"] = input["continue"]
  if (typeof input.forkSession === "boolean") result.forkSession = input.forkSession
  if (typeof input.allowDangerouslySkipPermissions === "boolean")
    result.allowDangerouslySkipPermissions = input.allowDangerouslySkipPermissions
  if (typeof input.strictMcpConfig === "boolean") result.strictMcpConfig = input.strictMcpConfig
  if (typeof input.permissionPromptToolName === "string" && input.permissionPromptToolName.length > 0)
    result.permissionPromptToolName = input.permissionPromptToolName
  result.additionalDirectories = pickStringArray(input.additionalDirectories)
  result.allowedTools = pickStringArray(input.allowedTools)
  result.disallowedTools = pickStringArray(input.disallowedTools)
  result.env = pickStringRecord(input.env)
  result.extraArgs = pickNullableStringRecord(input.extraArgs)
  result.plugins = pickPlugins(input.plugins)
  result.mcpServers = pickServerConfig(input.mcpServers)
  if (typeof input.executable === "string" && input.executable.length > 0) result.executable = input.executable
  result.executableArgs = pickStringArray(input.executableArgs)
  return result
}

function pickStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((item): item is string => typeof item === "string" && item.length > 0)
  if (filtered.length === 0) return undefined
  return filtered
}

function pickStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  if (entries.length === 0) return undefined
  const result: Record<string, string> = {}
  for (const entry of entries) result[entry[0]] = entry[1]
  return result
}

function pickNullableStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string | null] => typeof entry[1] === "string" || entry[1] === null,
  )
  if (entries.length === 0) return undefined
  const result: Record<string, string | null> = {}
  for (const entry of entries) result[entry[0]] = entry[1]
  return result
}

function pickPlugins(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((item): item is { type: "local"; path: string } => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    const typeValue = record["type"]
    if (typeValue !== "local") return false
    const pathValue = record["path"]
    if (typeof pathValue !== "string") return false
    return pathValue.length > 0
  })
  if (filtered.length === 0) return undefined
  return filtered
}

function pickServerConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    const entry = record[key]
    if (entry && typeof entry === "object") result[key] = entry
  }
  if (Object.keys(result).length === 0) return undefined
  return result as AgentOptions["mcpServers"]
}
