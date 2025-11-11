import { beforeEach, describe, expect, test } from "bun:test"
import { createProviderBridge } from "../../src/plugin/provider"
import { ProviderPluginRegistry } from "../../src/provider/plugin-registry"
import type { ProviderInfo, ProviderModality } from "@opencode-ai/plugin"

const text: ProviderModality = "text"

const info: ProviderInfo = {
  id: "test-provider",
  name: "Test Provider",
  env: ["TEST_KEY"],
  models: {
    alpha: {
      id: "alpha",
      name: "Alpha",
      releaseDate: "2025-01-01T00:00:00.000Z",
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
        context: 1,
        output: 1,
      },
      modalities: {
        input: [text],
        output: [text],
      },
      options: {},
    },
  },
}

beforeEach(() => {
  ProviderPluginRegistry.clear()
})

describe("provider bridge", () => {
  test("registers metadata and loader", async () => {
    const bridge = createProviderBridge()
    bridge.register({
      id: info.id,
      info,
      loader: () => ({
        autoload: true,
        options: { cwd: "/tmp" },
      }),
    })
    const entries = ProviderPluginRegistry.list()
    expect(entries.length).toBe(1)
    expect(entries[0]?.info?.id).toBe(info.id)
    expect(entries[0]?.loader).toBeDefined()
  })
})
