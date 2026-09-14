/** scripts/gen-assembly-manifest.mjs 的类型声明（供 test/*.test.ts 的 tsc 检查）。 */

export interface AssemblyManifestWireEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  external?: string[]
  immediately?: boolean
}

export interface AssemblyManifest {
  version: string
  frontend: { moduleJs: string; preloadJs: string[]; css: string[] }
  bootstrapUrl: string
  boot: {
    rev: string
    entries: AssemblyManifestWireEntry[]
    batches: { phase: string; url: string; rev: string; entries: string[] }[]
  }
}

export const ASSEMBLY_PACKAGE_NAMES: string[]

export function generateAssemblyManifest(options?: {
  nodeModulesDir?: string
  frontendDistDir?: string
}): Promise<AssemblyManifest>
