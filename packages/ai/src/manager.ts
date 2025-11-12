import type { AdapterId, AIAdapter } from "./types"
import { createAdapter as createAIAdapter } from "./adapters/ai"
import { createAdapter as createClaudeAdapter } from "./adapters/claude"
import { createAdapter as createCodexAdapter } from "./adapters/codex"

type Factory = () => AIAdapter

const factories: Record<AdapterId, Factory> = {
  ai: createAIAdapter,
  claude: createClaudeAdapter,
  codex: createCodexAdapter,
}

type RuntimeEnv = typeof globalThis & {
  Bun?: {
    env?: Record<string, string | undefined>
  }
  process?: {
    env?: Record<string, string | undefined>
  }
}

const runtime = globalThis as RuntimeEnv
const env = runtime.Bun?.env ?? runtime.process?.env ?? {}

const cache = new Map<AdapterId, AIAdapter>()
const state = {
  id: (env["OPENCODE_AI_ADAPTER"] as AdapterId) ?? "ai",
}

function sanitize(id: AdapterId | undefined) {
  if (!id) return "ai" as AdapterId
  if (!(id in factories)) return "ai"
  return id
}

export function useAdapter(id: AdapterId) {
  state.id = sanitize(id)
}

export function getAdapter() {
  const id = sanitize(state.id)
  const value = cache.get(id)
  if (value) return value
  const adapter = factories[id]()
  cache.set(id, adapter)
  return adapter
}
