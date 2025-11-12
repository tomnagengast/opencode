import { generateText, generateObject, streamText } from "ai"
import type { AIAdapter } from "../types"

export function createAdapter(): AIAdapter {
  return {
    id: "ai",
    generateText,
    generateObject,
    streamText,
  }
}
