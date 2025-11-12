import {
  query,
  type HookCallbackMatcher,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import type { AIAdapter } from "../types"
import type {
  AsyncIterableStream,
  FinishReason,
  JSONValue,
  LanguageModelRequestMetadata,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  ModelMessage,
  ProviderMetadata,
  StreamTextResult,
  Tool as AITool,
  ToolSet,
  TextStreamPart,
} from "ai"
import { z } from "zod"

type AbortSignalLike = {
  aborted?: boolean
  reason?: unknown
  addEventListener?: (type: "abort", listener: () => void, options?: { once?: boolean }) => void
}

type AbortControllerLike = {
  readonly signal: AbortSignalLike
  abort(reason?: unknown): void
}

type StreamTool = {
  toolCallId: string
  toolName: string
  input: unknown
}

type StreamUsage = {
  step?: LanguageModelUsage
  total?: LanguageModelUsage
}

type ClaudeInit = {
  tools: string[]
  slashCommands: string[]
  agents: string[]
  skills: string[]
  plugins: { name: string; path: string }[]
  permissionMode?: string
  cwd?: string
  claudeCodeVersion?: string
  model?: string
  apiKeySource?: string
}

type StreamState = {
  init?: ClaudeInit
  providerMetadata?: ProviderMetadata
}

type AsyncQueue<T> = {
  enqueue(value: T): void
  close(): void
  fail(reason: unknown): void
  [Symbol.asyncIterator](): AsyncIterator<T>
}

export function createAdapter(): AIAdapter {
  return {
    id: "claude",
    generateText: (input) => runGenerateText(input),
    generateObject: (input) => runGenerateObject(input),
    streamText: (input) => runStreamText(input),
  }
}

async function runGenerateText(input: any) {
  const prompt = resolvePrompt(input.prompt ?? input.messages)
  const opts = createOptions({
    abortSignal: input.abortSignal,
    model: input.model,
  })
  const run = query({
    prompt,
    options: {
      ...opts,
      includePartialMessages: false,
    },
  })
  const chunks: string[] = []
  const usage: StreamUsage = {}
  const state: StreamState = {}
  for await (const message of run) {
    if (isSystemInit(message)) {
      state.init = extractInit(message)
      state.providerMetadata = createProviderMetadata(undefined, state.init)
      continue
    }
    if (isAssistant(message)) {
      const part = extractText(message)
      if (part) chunks.push(part)
      updateUsage(usage, message.message.usage, false, state)
      continue
    }
    if (isResult(message)) updateUsage(usage, message.usage, true, state)
  }
  return {
    text: chunks.join("").trim(),
    usage: usage.total ?? usage.step ?? emptyUsage(),
    finishReason: "stop" as FinishReason,
  } as any
}

async function runGenerateObject(input: any) {
  const schema = input.schema ?? z.any()
  const base = await runGenerateText(input)
  const parsed = parseStructured(base.text, schema)
  return {
    ...base,
    object: parsed,
  } as any
}

function runStreamText<TOOLS extends ToolSet>(input: any): StreamTextResult<TOOLS, never> {
  const prompt = resolvePrompt(input.prompt ?? input.messages)
  const opts = createOptions({
    abortSignal: input.abortSignal,
    model: input.model,
  })
  const generator = query({
    prompt,
    options: {
      ...opts,
      includePartialMessages: true,
      hooks: opts.hooks,
    },
  })
  return createStreamResult({
    generator,
    model: input.model,
  }) as unknown as StreamTextResult<TOOLS, never>
}

function createOptions(input: { abortSignal?: AbortSignalLike; model?: string }) {
  const controller = createAbortController()
  const source = input.abortSignal
  if (source) {
    if (source.aborted) controller.abort(source.reason)
    source.addEventListener?.("abort", () => controller.abort(source.reason), { once: true })
  }
  const runtimeProcess = (globalThis as { process?: { cwd(): string; env: Record<string, string> } }).process
  const cwd = runtimeProcess?.cwd() ?? "."
  const env = runtimeProcess?.env ?? {}
  const hooks: Record<string, HookCallbackMatcher[]> = {}
  return {
    includePartialMessages: true,
    abortController: controller,
    cwd,
    hooks,
    env,
    model: typeof input.model === "string" ? input.model : undefined,
  }
}

function resolvePrompt(messages?: ModelMessage[] | string) {
  if (typeof messages === "string" && messages.trim().length > 0) return messages
  const list = Array.isArray(messages) ? messages : []
  const lines = list.map((msg) => {
    const role = msg.role.toUpperCase()
    const value = extractContent(msg.content)
    return `${role}:\n${value}`
  })
  if (lines.length === 0) throw new Error("Claude adapter requires at least one message")
  return lines.join("\n\n")
}

function extractContent(content: ModelMessage["content"]) {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (part.type === "text") return part.text
      if (part.type === "tool-call") {
        const args = "args" in part ? part.args : ("input" in part ? (part as any).input : {})
        return `[tool:${part.toolName}] ${JSON.stringify(args)}`
      }
      if (part.type === "tool-result") {
        const value = "result" in part ? (part as { result?: unknown }).result : (part as { content?: unknown }).content
        return `[tool-result:${part.toolCallId}] ${JSON.stringify(value)}`
      }
      return ""
    })
    .join("\n")
}

function extractText(message: SDKAssistantMessage) {
  const chunks: string[] = []
  for (const block of message.message.content ?? []) {
    if (block.type === "text" && block.text) chunks.push(block.text)
  }
  return chunks.join("")
}

function parseStructured(text: string, schema: z.Schema) {
  const trimmed = text.trim()
  const cleaned = trimmed.replace(/^```json/g, "").replace(/```$/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("Claude response did not include JSON")
  const json = cleaned.slice(start, end + 1)
  return schema.parse(JSON.parse(json))
}

function createStreamResult(input: { generator: AsyncGenerator<SDKMessage>; model?: string }): StreamTextResult<
  Record<string, AITool>,
  never
> {
  const text: string[] = []
  const usage: StreamUsage = {}
  const tools = new Map<string, StreamTool>()
  const finish = { reason: "stop" as FinishReason }
  const state: StreamState = {}
  const textQueue = createAsyncQueue<string>()
  const fullQueue = createAsyncQueue<TextStreamPart<Record<string, AITool>>>()
  const partialQueue = createAsyncQueue<never>()
  const done = createDeferred<void>()
  ;(async () => {
    try {
      for await (const chunk of streamClaude({
        generator: input.generator,
        text,
        usage,
        tools,
        finish,
        model: input.model,
        state,
      })) {
        fullQueue.enqueue(chunk)
        if (chunk.type === "text-delta") textQueue.enqueue(chunk.text)
      }
      if (!state.providerMetadata && state.init) {
        state.providerMetadata = createProviderMetadata(undefined, state.init)
      }
      textQueue.close()
      fullQueue.close()
      partialQueue.close()
      done.resolve()
    } catch (error) {
      textQueue.fail(error)
      fullQueue.fail(error)
      partialQueue.fail(error)
      done.reject(error)
    }
  })()
  const providerMetadataPromise = done.promise.then(() => state.providerMetadata)
  const result: StreamTextResult<Record<string, AITool>, never> = {
    content: Promise.resolve([]),
    text: done.promise.then(() => text.join("").trim()),
    reasoning: Promise.resolve([]),
    reasoningText: Promise.resolve(undefined),
    files: Promise.resolve([]),
    sources: Promise.resolve([]),
    toolCalls: Promise.resolve([]),
    staticToolCalls: Promise.resolve([]),
    dynamicToolCalls: Promise.resolve([]),
    staticToolResults: Promise.resolve([]),
    dynamicToolResults: Promise.resolve([]),
    toolResults: Promise.resolve([]),
    finishReason: done.promise.then(() => finish.reason),
    usage: done.promise.then(() => usage.step ?? emptyUsage()),
    totalUsage: done.promise.then(() => usage.total ?? usage.step ?? emptyUsage()),
    warnings: Promise.resolve(undefined),
    steps: Promise.resolve([]),
    request: Promise.resolve(createRequestMeta()),
    response: Promise.resolve(createResponseMeta(input.model)),
    providerMetadata: providerMetadataPromise,
    textStream: textQueue as unknown as AsyncIterableStream<string>,
    fullStream: fullQueue as unknown as AsyncIterableStream<TextStreamPart<Record<string, AITool>>>,
    experimental_partialOutputStream: partialQueue as unknown as AsyncIterableStream<never>,
    consumeStream: async () => {
      for await (const _ of fullQueue) {
        continue
      }
    },
    toUIMessageStream: (() => {
      throw new Error("UI message streaming is not supported for the Claude adapter.")
    }) as StreamTextResult<Record<string, AITool>, never>["toUIMessageStream"],
    pipeUIMessageStreamToResponse: (() => {
      throw new Error("UI message streaming is not supported for the Claude adapter.")
    }) as StreamTextResult<Record<string, AITool>, never>["pipeUIMessageStreamToResponse"],
    pipeTextStreamToResponse: (() => {
      throw new Error("Text stream piping is not supported for the Claude adapter.")
    }) as StreamTextResult<Record<string, AITool>, never>["pipeTextStreamToResponse"],
    toUIMessageStreamResponse: (() => {
      throw new Error("UI message stream responses are not supported for the Claude adapter.")
    }) as StreamTextResult<Record<string, AITool>, never>["toUIMessageStreamResponse"],
    toTextStreamResponse: (() => {
      throw new Error("Text stream responses are not supported for the Claude adapter.")
    }) as StreamTextResult<Record<string, AITool>, never>["toTextStreamResponse"],
  }
  return result
}

async function* streamClaude(input: {
  generator: AsyncGenerator<SDKMessage>
  text: string[]
  usage: StreamUsage
  tools: Map<string, StreamTool>
  finish: { reason: FinishReason }
  model?: string
  state: StreamState
}) {
  yield {
    type: "start" as const,
  }
  yield {
    type: "start-step" as const,
    request: createRequestMeta(),
    warnings: [],
  }
  for await (const message of input.generator) {
    if (isSystemInit(message)) {
      input.state.init = extractInit(message)
      input.state.providerMetadata = createProviderMetadata(undefined, input.state.init)
      continue
    }
    if (isAssistant(message)) {
      updateUsage(input.usage, message.message.usage, false, input.state)
      const parts = mapAssistant(message, input.tools, input.state)
      for (const part of parts) yield part
      continue
    }
    if (isUser(message)) {
      const parts = mapUser(message, input.tools, input.state)
      for (const part of parts) yield part
      continue
    }
    if (isStream(message)) {
      const parts = mapStreamEvent(message.event, input.tools, input.state)
      for (const part of parts) yield part
      continue
    }
    if (isResult(message)) {
      updateUsage(input.usage, message.usage, true, input.state)
      input.finish.reason = mapFinish(message.subtype)
      continue
    }
  }
  yield {
    type: "finish-step" as const,
    usage: input.usage.step ?? emptyUsage(),
    finishReason: input.finish.reason,
    response: createResponseMeta(input.model),
    providerMetadata: ensureMetadata(input.state),
  }
  yield {
    type: "finish" as const,
    finishReason: input.finish.reason,
    totalUsage: input.usage.total ?? input.usage.step ?? emptyUsage(),
  }
}

function mapStreamEvent(event: any, tools: Map<string, StreamTool>, state: StreamState) {
  const parts: TextStreamPart<Record<string, AITool>>[] = []
  const metadata = ensureMetadata(state)
  if (event.type === "content_block_start" && event.content_block?.type === "text") {
    parts.push({
      type: "text-start",
      id: `text-${event.index}`,
      providerMetadata: metadata,
    })
    return parts
  }
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
    parts.push({
      type: "text-delta",
      id: `text-${event.index}`,
      providerMetadata: metadata,
      text: event.delta.text,
    })
    return parts
  }
  if (event.type === "content_block_stop" && event.content_block?.type === "text") {
    parts.push({
      type: "text-end",
      id: `text-${event.index}`,
      providerMetadata: metadata,
    })
    return parts
  }
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    const tool = {
      toolCallId: event.content_block.id,
      toolName: event.content_block.name,
      input: event.content_block.input ?? {},
    }
    tools.set(tool.toolCallId, tool)
    parts.push({
      type: "tool-input-start",
      id: tool.toolCallId,
      toolName: tool.toolName,
      providerMetadata: metadata,
    })
    parts.push({
      type: "tool-call",
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      input: tool.input,
    } as TextStreamPart<Record<string, AITool>>)
    return parts
  }
  return parts
}

function mapAssistant(message: SDKAssistantMessage, tools: Map<string, StreamTool>, state: StreamState) {
  const parts: TextStreamPart<Record<string, AITool>>[] = []
  const metadata = ensureMetadata(state)
  for (const block of message.message.content ?? []) {
    if (block.type === "text" && block.text) {
      parts.push({
        type: "text-start",
        id: block.id ?? message.message.id,
        providerMetadata: metadata,
      })
      parts.push({
        type: "text-delta",
        id: block.id ?? message.message.id,
        providerMetadata: metadata,
        text: block.text,
      })
      parts.push({
        type: "text-end",
        id: block.id ?? message.message.id,
        providerMetadata: metadata,
      })
      continue
    }
    if (block.type === "tool_use") {
      const tool = {
        toolCallId: block.id,
        toolName: block.name,
        input: block.input ?? {},
      }
      tools.set(tool.toolCallId, tool)
      parts.push({
        type: "tool-input-start",
        id: tool.toolCallId,
        toolName: tool.toolName,
        providerMetadata: metadata,
      })
      parts.push({
        type: "tool-call",
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        input: tool.input,
      } as TextStreamPart<Record<string, AITool>>)
    }
  }
  return parts
}

function mapUser(message: SDKUserMessage, tools: Map<string, StreamTool>, state: StreamState) {
  const parts: TextStreamPart<Record<string, AITool>>[] = []
  const metadata = ensureMetadata(state)
  for (const block of message.message.content ?? []) {
    if (block.type === "tool_result") {
      const tool = tools.get(block.tool_use_id)
      const resultText = formatToolResult(block.content)
      parts.push({
        type: "tool-result",
        toolCallId: block.tool_use_id,
        toolName: tool?.toolName ?? "unknown",
        input: tool?.input ?? {},
        output: {
          output: resultText,
          metadata: {},
          title: tool?.toolName ?? "Tool Result",
          attachments: undefined,
        },
      } as TextStreamPart<Record<string, AITool>>)
      parts.push({
        type: "tool-input-end",
        id: block.tool_use_id,
        providerMetadata: metadata,
      })
      tools.delete(block.tool_use_id)
    }
  }
  return parts
}

function mapFinish(type: SDKResultMessage["subtype"]): FinishReason {
  if (type === "success") return "stop"
  if (type === "error_max_turns") return "length"
  return "error"
}

function createRequestMeta(): LanguageModelRequestMetadata {
  return {
    headers: {},
    body: undefined,
    method: "claude",
    url: undefined,
    timestamp: new Date(),
  } as LanguageModelRequestMetadata
}

function createResponseMeta(model?: string): LanguageModelResponseMetadata & { messages: any[] } {
  return {
    headers: {},
    modelId: model ?? "claude",
    timestamp: new Date(),
    id: `claude-${Date.now().toString(36)}`,
    messages: [] as any[],
  }
}

function updateUsage(target: StreamUsage, raw: any, total: boolean, state: StreamState) {
  const usage = convertUsage(raw)
  const metadata = createProviderMetadata(raw, state.init)
  state.providerMetadata = metadata
  if (total) {
    target.total = usage
    return
  }
  target.step = usage
}

function convertUsage(raw?: any): LanguageModelUsage {
  if (!raw) return emptyUsage()
  const inputTokens = raw.input_tokens ?? 0
  const outputTokens = raw.output_tokens ?? 0
  const totalTokens = raw.total_tokens ?? inputTokens + outputTokens + (raw.thinking_tokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: raw.thinking_tokens ?? 0,
    cachedInputTokens: raw.cache_read_input_tokens ?? 0,
    totalTokens,
  }
}

function emptyUsage(): LanguageModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  }
}

function ensureMetadata(state: StreamState) {
  if (!state.providerMetadata && state.init) {
    state.providerMetadata = createProviderMetadata(undefined, state.init)
  }
  return state.providerMetadata
}

function createProviderMetadata(raw: any, init?: ClaudeInit): ProviderMetadata {
  const cacheCreationInputTokens = raw?.cache_creation_input_tokens ?? 0
  const cacheReadInputTokens = raw?.cache_read_input_tokens ?? 0
  const anthropic: Record<string, JSONValue> = {
    cacheCreationInputTokens,
    cacheReadInputTokens,
  }
  if (init) anthropic.init = serializeInit(init)
  return {
    anthropic,
  }
}

function createAbortController(): AbortControllerLike {
  const ctor = (globalThis as { AbortController?: new () => AbortControllerLike }).AbortController
  if (ctor) return new ctor()
  return new FallbackAbortController()
}

class FallbackAbortController implements AbortControllerLike {
  signal: AbortSignalLike
  private aborted = false
  private readonly listeners: (() => void)[] = []

  constructor() {
    this.signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (_type, listener, options) => {
        this.listeners.push(listener)
        if (options?.once && this.aborted) listener()
      },
    }
  }

  abort(reason?: unknown): void {
    if (this.aborted) return
    this.aborted = true
    this.signal.aborted = true
    this.signal.reason = reason
    for (const listener of this.listeners) listener()
  }
}

function extractInit(message: SDKSystemMessage): ClaudeInit {
  return {
    tools: message.tools ?? [],
    slashCommands: message.slash_commands ?? [],
    agents: message.agents ?? [],
    skills: message.skills ?? [],
    plugins: message.plugins ?? [],
    permissionMode: message.permissionMode,
    cwd: message.cwd,
    claudeCodeVersion: message.claude_code_version,
    model: message.model,
    apiKeySource: message.apiKeySource,
  }
}

function serializeInit(init: ClaudeInit): Record<string, JSONValue> {
  const result: Record<string, JSONValue> = {
    tools: init.tools,
    slashCommands: init.slashCommands,
    agents: init.agents,
    skills: init.skills,
    plugins: init.plugins.map((plugin) => ({
      name: plugin.name,
      path: plugin.path,
    })),
  }
  if (init.permissionMode) result.permissionMode = init.permissionMode
  if (init.cwd) result.cwd = init.cwd
  if (init.claudeCodeVersion) result.claudeCodeVersion = init.claudeCodeVersion
  if (init.model) result.model = init.model
  if (init.apiKeySource) result.apiKeySource = init.apiKeySource
  return result
}

function isAssistant(message: SDKMessage): message is SDKAssistantMessage {
  return message.type === "assistant"
}

function isResult(message: SDKMessage): message is SDKResultMessage {
  return message.type === "result"
}

function isUser(message: SDKMessage): message is SDKUserMessage {
  return message.type === "user"
}

function isStream(message: SDKMessage): message is SDKPartialAssistantMessage {
  return message.type === "stream_event"
}

function isSystemInit(message: SDKMessage): message is SDKSystemMessage {
  return message.type === "system" && (message as SDKSystemMessage).subtype === "init"
}

function formatToolResult(content: unknown) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry
        if (entry && typeof entry === "object" && "type" in entry && (entry as any).type === "text") {
          return (entry as any).text ?? ""
        }
        return ""
      })
      .join("\n")
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text?: unknown }).text ?? "")
  }
  return ""
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = []
  const pending: { resolve: (value: IteratorResult<T>) => void; reject: (reason?: unknown) => void }[] = []
  let closed = false
  let failed: unknown

  return {
    enqueue(value: T) {
      if (closed || failed) return
      if (pending.length > 0) {
        const waiter = pending.shift()
        waiter?.resolve({ value, done: false })
        return
      }
      values.push(value)
    },
    close() {
      if (closed || failed) return
      closed = true
      while (pending.length > 0) {
        const waiter = pending.shift()
        waiter?.resolve({ value: undefined as any, done: true })
      }
    },
    fail(reason: unknown) {
      if (closed || failed) return
      failed = reason
      while (pending.length > 0) {
        const waiter = pending.shift()
        waiter?.reject(reason)
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (failed) return Promise.reject(failed)
          if (values.length > 0) return Promise.resolve({ value: values.shift() as T, done: false })
          if (closed) return Promise.resolve({ value: undefined as any, done: true })
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            pending.push({ resolve, reject })
          })
        },
        [Symbol.asyncIterator]() {
          return this
        },
      }
    },
  }
}

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
