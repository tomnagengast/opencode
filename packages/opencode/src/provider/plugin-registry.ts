import type { ModelsDev } from "./models"
import type { CustomLoader } from "./loader"

type Entry = {
  id: string
  info?: ModelsDev.Provider
  loader?: CustomLoader
}

const entries: Entry[] = []

export namespace ProviderPluginRegistry {
  export function register(entry: Entry) {
    entries.push(entry)
  }

  export function list() {
    return entries
  }

  export function clear() {
    entries.splice(0, entries.length)
  }
}
