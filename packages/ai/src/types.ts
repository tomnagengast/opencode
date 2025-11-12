export type GenerateText = typeof import("ai").generateText
export type GenerateObject = typeof import("ai").generateObject
export type StreamText = typeof import("ai").streamText

export type AdapterId = "ai" | "claude" | "codex"

export type AIAdapter = {
  id: AdapterId
  generateText: GenerateText
  generateObject: GenerateObject
  streamText: StreamText
}
