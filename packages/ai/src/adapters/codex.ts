import type { AIAdapter } from "../types"

function unsupported(feature: string): never {
  throw new Error(`Codex adapter does not implement ${feature} yet`)
}

export function createAdapter(): AIAdapter {
  const failStream = () => unsupported("streamText")
  const failObject = () => unsupported("generateObject")
  const failText = () => unsupported("generateText")

  return {
    id: "codex",
    generateText: (input) => failText(),
    generateObject: (input) => failObject(),
    streamText: (input) => failStream(),
  }
}
