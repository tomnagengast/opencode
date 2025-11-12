import type { Plugin, ProviderAdapter } from "@opencode-ai/plugin"
import path from "path"
import os from "os"

// Helper function to extract content from ModelMessage format
function extractMessageContent(msg: any): string {
  // Handle direct content string
  if (typeof msg.content === "string") {
    return msg.content
  }

  // Handle content parts array
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => {
        if (typeof part === "string") return part
        if (part.type === "text") return part.text
        if (part.type === "image") return "[Image]"
        if (part.type === "tool-result") return `[Tool Result: ${part.toolName}]`
        return JSON.stringify(part)
      })
      .join("\n")
  }

  // Fallback for unexpected formats
  return JSON.stringify(msg.content || "")
}

export const providerPlugin: Plugin = async (input) => {
  const adapters: ProviderAdapter[] = []

  // Claude Agent SDK Provider
  try {
    const claudeAgentAdapter: ProviderAdapter = {
      type: "external",
      id: "claude-agent",
      displayName: "Claude Agent SDK",
      models: {
        default: {
          id: "claude-sonnet-4-5",
          name: "Claude Agent (Sonnet 4.5)",
        },
      },
      runExternal: async (runInput) => {
        // Dynamically import the Claude Agent SDK
        const { createAgent } = await import("@anthropic-ai/claude-agent-sdk")

        // Get API key from environment or config
        const apiKey = process.env.ANTHROPIC_API_KEY

        if (!apiKey) {
          throw new Error("ANTHROPIC_API_KEY environment variable is required for claude-agent provider")
        }

        // Set up log directory
        const projectPath = input.directory.replace(/\//g, "-")
        const logDir = path.join(os.homedir(), ".claude", "projects", projectPath)

        // Ensure log directory exists
        await input.$`mkdir -p ${logDir}`.quiet()

        // Create the agent with the specified working directory
        const agent = createAgent({
          apiKey,
          workingDirectory: runInput.cwd,
          logDirectory: logDir,
        })

        // Convert messages to the format expected by Claude Agent SDK
        const messages = runInput.messages.map((msg: any) => ({
          role: msg.role,
          content: extractMessageContent(msg),
        }))

        // Build system prompt
        const systemPrompt = runInput.system.join("\n\n")

        // Run the agent
        const result = await agent.run({
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
        })

        // Extract tool calls if any
        const toolCalls = result.toolCalls?.map((call: any, index: number) => ({
          id: call.id || `tool-${index}`,
          tool: call.name,
          input: call.input,
          output: call.result,
          error: call.error,
        }))

        return {
          logDir,
          threadID: result.threadId,
          text: result.text,
          toolCalls,
        }
      },
    }

    adapters.push(claudeAgentAdapter)
  } catch (error) {
    console.warn("Failed to load Claude Agent SDK provider:", error)
  }

  // Codex SDK Provider
  try {
    const codexAdapter: ProviderAdapter = {
      type: "external",
      id: "codex",
      displayName: "OpenAI Codex SDK",
      models: {
        default: {
          id: "gpt-5",
          name: "Codex (GPT-5)",
        },
      },
      runExternal: async (runInput) => {
        // Dynamically import the Codex SDK
        const { createCodex } = await import("@openai/codex-sdk")

        // Get API key from environment or config
        const apiKey = process.env.OPENAI_API_KEY

        if (!apiKey) {
          throw new Error("OPENAI_API_KEY environment variable is required for codex provider")
        }

        // Set up session directory
        const sessionDir = path.join(input.directory, ".codex", "sessions")

        // Ensure session directory exists
        await input.$`mkdir -p ${sessionDir}`.quiet()

        // Create the codex instance
        const codex = createCodex({
          apiKey,
          workingDirectory: runInput.cwd,
          persistenceDirectory: sessionDir,
        })

        // Convert messages to the format expected by Codex SDK
        const messages = runInput.messages.map((msg: any) => ({
          role: msg.role,
          content: extractMessageContent(msg),
        }))

        // Build system prompt
        const systemPrompt = runInput.system.join("\n\n")

        // Start or resume a thread
        const thread = await codex.startThread({
          sessionID: runInput.sessionID,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
        })

        // Run the thread
        const result = await thread.run()

        // Extract tool calls if any
        const toolCalls = result.toolCalls?.map((call: any, index: number) => ({
          id: call.id || `tool-${index}`,
          tool: call.name,
          input: call.input,
          output: call.result,
          error: call.error,
        }))

        return {
          logDir: sessionDir,
          threadID: result.threadId,
          taskID: result.taskId,
          text: result.text,
          toolCalls,
        }
      },
    }

    adapters.push(codexAdapter)
  } catch (error) {
    console.warn("Failed to load Codex SDK provider:", error)
  }

  return {
    provider: adapters,
  }
}
