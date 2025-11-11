export type ProviderRegistry = {
  register(input: ProviderRegistration): void
}

export type ProviderRegistration = {
  id: string
  info?: ProviderInfo
  loader?: ProviderLoader
}

export type ProviderInfo = {
  id: string
  name: string
  env: string[]
  api?: string
  npm?: string
  models: Record<string, ProviderModel>
}

export type ProviderModel = {
  id: string
  name: string
  releaseDate: string
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  toolCall: boolean
  cost: ProviderModelCost
  limit: {
    context: number
    output: number
  }
  modalities?: {
    input: ProviderModality[]
    output: ProviderModality[]
  }
  experimental?: boolean
  status?: "alpha" | "beta" | "deprecated"
  options?: Record<string, unknown>
  headers?: Record<string, string>
}

export type ProviderModality = "text" | "audio" | "image" | "video" | "pdf"

export type ProviderModelCost = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export type ProviderLoaderResult = {
  autoload: boolean
  getModel?: (sdk: unknown, modelID: string, options?: Record<string, any>) => Promise<unknown>
  options?: Record<string, any>
  skipSDK?: boolean
}

export type ProviderLoader = (provider: ProviderInfo) => Promise<ProviderLoaderResult | void> | ProviderLoaderResult | void
