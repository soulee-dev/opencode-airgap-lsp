/**
 * Fetcher dispatcher.
 * Given an LspEntry + Target, picks the right source descriptor and fetcher.
 */

import type { LspEntry, Target, FetchedArtifact, Source } from "../types.ts"
import { fetchGithubRelease, fetchGithubZip } from "./github.ts"
import { fetchNpm } from "./npm.ts"
import { fetchHashicorp } from "./hashicorp.ts"
import { fetchKotlinLsp } from "./jetbrains.ts"
import { fetchJdtls } from "./eclipse.ts"
import { fetchDotnetTool } from "./dotnet.ts"
import { fetchRubyGem } from "./rubygem.ts"

export function sourceForTarget(entry: LspEntry, target: Target): Source | undefined {
  const key = `${target.platform}-${target.arch}` as const
  return entry.source[key] ?? entry.source["*"]
}

export async function fetchEntry(entry: LspEntry, target: Target, destDir: string): Promise<FetchedArtifact> {
  const source = sourceForTarget(entry, target)
  if (!source) {
    throw new Error(`No source defined for ${entry.id} on ${target.platform}-${target.arch}`)
  }
  switch (source.kind) {
    case "github-release":
      return fetchGithubRelease(entry.id, target, source, destDir)
    case "github-zip":
      return fetchGithubZip(entry.id, target, source, destDir)
    case "npm":
      return fetchNpm(entry.id, target, source, destDir)
    case "hashicorp":
      return fetchHashicorp(entry.id, target, source, destDir)
    case "jetbrains-kotlin-lsp":
      return fetchKotlinLsp(entry.id, target, source, destDir)
    case "eclipse-jdtls":
      return fetchJdtls(entry.id, target, source, destDir)
    case "dotnet-tool":
      return fetchDotnetTool(entry.id, target, source, destDir)
    case "rubygem":
      return fetchRubyGem(entry.id, target, source, destDir)
    case "toolchain":
      throw new Error(`${entry.id} is toolchain-only and cannot be fetched`)
    default: {
      // Exhaustiveness check
      const _exhaustive: never = source
      throw new Error(`Unknown source kind: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
