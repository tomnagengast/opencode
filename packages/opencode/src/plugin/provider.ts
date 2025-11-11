import type { ProviderRegistry, ProviderRegistration, ProviderInfo, ProviderModel } from "@opencode-ai/plugin"
import { ProviderPluginRegistry } from "../provider/plugin-registry"
import type { ModelsDev } from "../provider/models"
import type { CustomLoader } from "../provider/loader"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.provider" })

export function createProviderBridge(): ProviderRegistry {
  return {
    register(input) {
      const info = input.info ? toProviderInfo(input.info) : undefined
      const loader = input.loader ? wrapLoader(input.loader, input.info) : undefined
      log.info("provider.register", {
        providerID: input.id,
        hasInfo: Boolean(info),
        hasLoader: Boolean(loader),
      })
      ProviderPluginRegistry.register({
        id: input.id,
        info,
        loader,
      })
    },
  }
}

function wrapLoader(loader: NonNullable<ProviderRegistration["loader"]>, source?: ProviderInfo): CustomLoader {
  return async (provider) => {
    const payload = source ?? fromProvider(provider)
    log.info("provider.loader.start", { providerID: payload.id })
    return Promise.resolve(loader(payload))
      .then((result) => {
        log.info("provider.loader.finish", {
          providerID: payload.id,
          autoload: Boolean(result?.autoload),
        })
        if (!result) return
        return {
          autoload: result.autoload,
          getModel: result.getModel,
          options: result.options,
          skipSDK: result.skipSDK,
        }
      })
      .catch((error) => {
        log.error("provider.loader.error", {
          providerID: payload.id,
          error,
        })
        throw error
      })
  }
}

function toProviderInfo(info: ProviderInfo): ModelsDev.Provider {
  const models = Object.fromEntries(
    Object.entries(info.models).map(([id, model]) => [id, toProviderModel(model)]),
  )
  return {
    api: info.api,
    env: [...info.env],
    id: info.id,
    name: info.name,
    npm: info.npm,
    models,
  }
}

function toProviderModel(model: ProviderModel): ModelsDev.Model {
  const modalities =
    model.modalities &&
    ({
      input: [...model.modalities.input],
      output: [...model.modalities.output],
    } as ModelsDev.Model["modalities"])
  const cost = {
    input: model.cost.input,
    output: model.cost.output,
    cache_read: model.cost.cacheRead,
    cache_write: model.cost.cacheWrite,
  }
  return {
    id: model.id,
    name: model.name,
    release_date: model.releaseDate,
    attachment: model.attachment,
    reasoning: model.reasoning,
    temperature: model.temperature,
    tool_call: model.toolCall,
    cost,
    limit: {
      context: model.limit.context,
      output: model.limit.output,
    },
    modalities,
    experimental: model.experimental,
    status: model.status,
    options: model.options ?? {},
    headers: model.headers,
    provider: undefined,
  }
}

function fromProvider(provider: ModelsDev.Provider): ProviderInfo {
  const models = Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, fromProviderModel(model)]))
  return {
    api: provider.api,
    env: [...provider.env],
    id: provider.id,
    name: provider.name,
    npm: provider.npm,
    models,
  }
}

function fromProviderModel(model: ModelsDev.Model): ProviderModel {
  const modalities =
    model.modalities &&
    ({
      input: [...model.modalities.input],
      output: [...model.modalities.output],
    } satisfies ProviderModel["modalities"])
  return {
    id: model.id,
    name: model.name,
    releaseDate: model.release_date,
    attachment: model.attachment,
    reasoning: model.reasoning,
    temperature: model.temperature,
    toolCall: model.tool_call,
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cache_read,
      cacheWrite: model.cost.cache_write,
    },
    limit: {
      context: model.limit.context,
      output: model.limit.output,
    },
    modalities,
    experimental: model.experimental,
    status: model.status,
    options: model.options,
    headers: model.headers,
  }
}
