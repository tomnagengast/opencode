import { defineConfig, type PluginOption } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"

type BunSpawnIO = "inherit" | "pipe" | "ignore"
type BunSubprocess = {
  kill(code?: number): void
}
type BunRuntime = {
  spawn(input: { cmd: string[]; cwd?: string; stdout?: BunSpawnIO; stderr?: BunSpawnIO }): BunSubprocess
  sleep(ms: number): Promise<void>
}
const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun
const backendPlugins = bunRuntime ? [opencodeBackend(bunRuntime)] : []

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    ...backendPlugins,
    tailwindcss(),
    solidPlugin(),
    iconsSpritesheet({
      withTypes: true,
      inputDir: "src/assets/file-icons",
      outputDir: "src/ui/file-icons",
      formatter: "prettier",
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "solid-js",
  },
  optimizeDeps: {
    esbuildOptions: {
      jsx: "automatic",
      jsxImportSource: "solid-js",
    },
  },
  build: {
    target: "esnext",
  },
})

function opencodeBackend(bun: BunRuntime): PluginOption {
  const dir = path.resolve(__dirname, "../opencode")
  const host = process.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
  const port = process.env.VITE_OPENCODE_SERVER_PORT ?? "4096"
  const url = `http://${host}:${port}`
  const state = {
    proc: undefined as ReturnType<typeof bun.spawn> | undefined,
  }

  const kill = () => {
    if (!state.proc) return
    state.proc.kill()
    state.proc = undefined
  }

  const signals = ["SIGINT", "SIGTERM"] as const
  for (const signal of signals) {
    process.on(signal, kill)
  }

  const ping = async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 300)
    const res = await fetch(`${url}/config`, { signal: ctrl.signal }).catch(() => undefined)
    clearTimeout(timer)
    return Boolean(res?.ok)
  }

  const wait = async () => {
    const times = [50, 100, 200, 400, 800]
    for (const time of times) {
      if (await ping()) return true
      await bun.sleep(time)
    }
    const last = await ping()
    return last
  }

  const start = async () => {
    const cmd = [
      "bun",
      "--conditions=browser",
      "src/index.ts",
      "serve",
      "--hostname",
      host,
      "--port",
      port,
    ]
    console.info(`[opencode] starting backend on ${url}`)
    state.proc = bun.spawn({
      cmd,
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    })
    await wait()
  }

  return {
    name: "opencode-backend",
    apply: "serve",
    async configureServer(server) {
      server.httpServer?.once("close", kill)
      if (await ping()) return
      await start()
    },
  }
}
