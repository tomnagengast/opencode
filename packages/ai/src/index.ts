import { getAdapter, useAdapter } from "./manager"
import type { AdapterId, GenerateObject, GenerateText, StreamText } from "./types"

export type {
  ModelMessage,
  StreamTextResult,
  Tool,
  LanguageModelUsage,
  ProviderMetadata,
  UIMessage,
  LanguageModel,
  Provider as SDK,
} from "ai"

export {
  APICallError,
  LoadAPIKeyError,
  NoSuchModelError,
  convertToModelMessages,
  experimental_createMCPClient,
  jsonSchema,
  stepCountIs,
  tool,
  wrapLanguageModel,
} from "ai"

export type { AdapterId }

export function setAIAdapter(id: AdapterId) {
  useAdapter(id)
}

export const generateText: GenerateText = (...args) => getAdapter().generateText(...args)

export const generateObject: GenerateObject = (...args) => getAdapter().generateObject(...args)

export const streamText: StreamText = (...args) => getAdapter().streamText(...args)
