import type { ModelsDev } from "./models"

export type CustomLoader = (provider: ModelsDev.Provider) => Promise<LoaderResult | void> | LoaderResult | void

export type LoaderResult = {
  autoload: boolean
  getModel?: (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
  options?: Record<string, any>
  skipSDK?: boolean
}
