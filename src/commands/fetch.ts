/**
 * `oalsp fetch` — download raw LSP artifacts for one or more targets.
 *
 * Output layout:
 *   <out>/<platform>-<arch>/raw/*.{zip,tar.gz,tgz,nupkg,gem,...}
 *   <out>/<platform>-<arch>/manifest.json
 *
 * Flags:
 *   --out <dir>       Output directory (default: ./work)
 *   --targets <list>  Comma-separated target list (default: all). e.g. "win32-x64,linux-x64"
 *   --only <ids>      Comma-separated LSP ids to fetch (default: all bundleable)
 *   --skip <ids>      Comma-separated LSP ids to skip
 *   --concurrency N   Parallel downloads per target (default: 4)
 */

import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { REGISTRY, bundleableEntries, toolchainEntries } from "../registry.ts"
import type { FetchedArtifact, LspEntry, Target, TargetManifest } from "../types.ts"
import { ALL_TARGETS } from "../types.ts"
import { fetchEntry, sourceForTarget } from "../fetchers/index.ts"
import { humanBytes } from "../fetchers/util.ts"

export interface FetchOptions {
  out: string
  targets: Target[]
  only?: string[]
  skip?: string[]
  concurrency: number
  producer: string
}

export async function runFetch(opts: FetchOptions): Promise<void> {
  const entries = selectEntries(opts.only, opts.skip)
  if (entries.length === 0) {
    console.error("No LSPs selected. Check --only/--skip filters.")
    process.exit(1)
  }

  console.log(`Fetching ${entries.length} bundleable LSPs for ${opts.targets.length} target(s)`)
  console.log(`Targets: ${opts.targets.map((t) => `${t.platform}-${t.arch}`).join(", ")}`)
  console.log(`Output:  ${path.resolve(opts.out)}`)
  console.log()

  for (const target of opts.targets) {
    await fetchForTarget(target, entries, opts)
  }
}

function selectEntries(only?: string[], skip?: string[]): LspEntry[] {
  let entries = bundleableEntries()
  if (only && only.length > 0) {
    const set = new Set(only)
    entries = entries.filter((e) => set.has(e.id))
    const missing = [...set].filter((id) => !entries.find((e) => e.id === id))
    if (missing.length > 0) {
      const toolchain = toolchainEntries().filter((e) => missing.includes(e.id))
      if (toolchain.length > 0) {
        console.warn(`Skipping toolchain-only LSPs (can't be bundled): ${toolchain.map((e) => e.id).join(", ")}`)
      }
      const unknown = missing.filter((id) => !REGISTRY.find((e) => e.id === id))
      if (unknown.length > 0) {
        throw new Error(`Unknown LSP ids: ${unknown.join(", ")}`)
      }
    }
  }
  if (skip && skip.length > 0) {
    const set = new Set(skip)
    entries = entries.filter((e) => !set.has(e.id))
  }
  return entries
}

async function fetchForTarget(target: Target, entries: LspEntry[], opts: FetchOptions): Promise<void> {
  const label = `${target.platform}-${target.arch}`
  const rawDir = path.join(opts.out, label, "raw")
  await mkdir(rawDir, { recursive: true })

  // Filter out entries that have no source for this target (e.g. clangd on arm64).
  const applicable = entries.filter((e) => !!sourceForTarget(e, target))
  const skipped = entries.filter((e) => !sourceForTarget(e, target)).map((e) => e.id)

  console.log(`━━━ [${label}] fetching ${applicable.length} / ${entries.length} LSPs`)
  if (skipped.length > 0) {
    console.log(`  (no source for this target: ${skipped.join(", ")})`)
  }

  const manifest: TargetManifest = {
    schemaVersion: 1,
    target,
    generatedAt: new Date().toISOString(),
    producer: opts.producer,
    artifacts: [],
    failed: [],
    skippedToolchain: toolchainEntries().map((e) => e.id),
  }

  // Simple bounded parallelism.
  const queue = [...applicable]
  let inflight = 0
  let completed = 0

  await new Promise<void>((resolve) => {
    const tryNext = () => {
      if (queue.length === 0 && inflight === 0) {
        resolve()
        return
      }
      while (inflight < opts.concurrency && queue.length > 0) {
        const entry = queue.shift()!
        inflight++
        const start = Date.now()
        fetchEntry(entry, target, rawDir)
          .then((artifact) => {
            manifest.artifacts.push(artifact)
            const totalBytes =
              artifact.size + (artifact.extras?.reduce((acc, x) => acc + x.size, 0) ?? 0)
            completed++
            const ms = Date.now() - start
            console.log(
              `  [${completed}/${applicable.length}] ${entry.id.padEnd(24)} ` +
                `v${artifact.version.padEnd(12)} ${humanBytes(totalBytes).padStart(9)} ` +
                `(${ms}ms)`,
            )
          })
          .catch((err) => {
            manifest.failed.push({ id: entry.id, reason: err instanceof Error ? err.message : String(err) })
            completed++
            console.error(`  [${completed}/${applicable.length}] ${entry.id.padEnd(24)} FAILED: ${err instanceof Error ? err.message : err}`)
          })
          .finally(() => {
            inflight--
            tryNext()
          })
      }
    }
    tryNext()
  })

  const manifestPath = path.join(opts.out, label, "manifest.json")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  const totalSize = manifest.artifacts.reduce(
    (acc, a) => acc + a.size + (a.extras?.reduce((x, e) => x + e.size, 0) ?? 0),
    0,
  )
  console.log(
    `  ✓ ${manifest.artifacts.length} succeeded, ${manifest.failed.length} failed, total ${humanBytes(totalSize)}`,
  )
  console.log(`  ✓ manifest: ${manifestPath}`)
  console.log()
}
