#!/usr/bin/env bun
/**
 * `oalsp` — CLI entrypoint.
 *
 * Usage:
 *   oalsp fetch    [--out ./work] [--targets win32-x64,linux-x64] [--only id,id] [--skip id,id] [--concurrency 4]
 *   oalsp bundle   [--work ./work] [--out ./bundles] [--targets ...]
 *   oalsp install  --bundle <file> [--prefix ~/.opencode-lsp] [--skip-verify] [--only ...] [--skip ...]
 *   oalsp config   [--prefix ~/.opencode-lsp] [--out <file>] [--only-installed] [--merge <opencode.jsonc>]
 *   oalsp list     [--verbose]
 */

import os from "node:os"
import path from "node:path"
import { REGISTRY, bundleableEntries, toolchainEntries } from "./registry.ts"
import { ALL_TARGETS, type Target } from "./types.ts"
import { runFetch } from "./commands/fetch.ts"
import { runBundle } from "./commands/bundle.ts"
import { runInstall } from "./commands/install.ts"
import { runConfig } from "./commands/config.ts"

const PRODUCER = "opencode-airgap-lsp/0.1.0"

function usage(): never {
  console.error(
    `oalsp — offline LSP bundler/installer for opencode (${PRODUCER})

COMMANDS

  fetch       Download raw LSP artifacts (run on an internet-connected machine)
  bundle      Pack fetched artifacts into per-target tar.gz
  install     Extract a bundle on an air-gapped target machine
  config      Generate opencode.jsonc pointing at installed binaries
  list        List supported LSPs

Run 'oalsp <command> --help' for command-specific flags.`,
  )
  process.exit(2)
}

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === "-h" || cmd === "--help") usage()
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!
    if (!tok.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${tok}`)
    }
    const eq = tok.indexOf("=")
    if (eq >= 0) {
      flags[tok.slice(2, eq)] = tok.slice(eq + 1)
    } else {
      const key = tok.slice(2)
      const next = rest[i + 1]
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    }
  }
  return { cmd, flags }
}

function parseTargets(v: string | undefined): Target[] {
  if (!v) return [...ALL_TARGETS]
  return v.split(",").map((s) => {
    const m = /^(win32|linux|darwin)-(x64|arm64)$/.exec(s.trim())
    if (!m) throw new Error(`Invalid target: ${s} (expected: win32-x64, linux-arm64, etc.)`)
    return { platform: m[1] as Target["platform"], arch: m[2] as Target["arch"] }
  })
}

function parseList(v: string | boolean | undefined): string[] | undefined {
  if (!v || typeof v !== "string") return undefined
  return v.split(",").map((s) => s.trim()).filter(Boolean)
}

function defaultPrefix(): string {
  return process.env["OALSP_PREFIX"] ?? path.join(os.homedir(), ".opencode-lsp")
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2))

  switch (cmd) {
    case "fetch": {
      if (flags.help) {
        console.log("oalsp fetch [--out ./work] [--targets ...] [--only ...] [--skip ...] [--concurrency N]")
        return
      }
      await runFetch({
        out: typeof flags.out === "string" ? flags.out : "./work",
        targets: parseTargets(typeof flags.targets === "string" ? flags.targets : undefined),
        only: parseList(flags.only),
        skip: parseList(flags.skip),
        concurrency: typeof flags.concurrency === "string" ? Math.max(1, parseInt(flags.concurrency, 10)) : 4,
        producer: PRODUCER,
      })
      return
    }

    case "bundle": {
      if (flags.help) {
        console.log("oalsp bundle [--work ./work] [--out ./bundles] [--targets ...]")
        return
      }
      await runBundle({
        work: typeof flags.work === "string" ? flags.work : "./work",
        out: typeof flags.out === "string" ? flags.out : "./bundles",
        ...(typeof flags.targets === "string" ? { targets: parseTargets(flags.targets) } : {}),
      })
      return
    }

    case "install": {
      if (flags.help) {
        console.log(
          "oalsp install --bundle <file> [--prefix ~/.opencode-lsp] [--skip-verify] [--only ...] [--skip ...]",
        )
        return
      }
      if (typeof flags.bundle !== "string") {
        console.error("--bundle <path> is required")
        process.exit(2)
      }
      await runInstall({
        bundle: flags.bundle,
        prefix: typeof flags.prefix === "string" ? flags.prefix : defaultPrefix(),
        ...(typeof flags.stage === "string" ? { stage: flags.stage } : {}),
        skipVerify: flags["skip-verify"] === true,
        ...(parseList(flags.only) ? { only: parseList(flags.only) } : {}),
        ...(parseList(flags.skip) ? { skip: parseList(flags.skip) } : {}),
      } as Parameters<typeof runInstall>[0])
      return
    }

    case "config": {
      if (flags.help) {
        console.log(
          "oalsp config [--prefix ~/.opencode-lsp] [--out <file>] [--only-installed] [--merge <existing.jsonc>]",
        )
        return
      }
      const prefix = typeof flags.prefix === "string" ? flags.prefix : defaultPrefix()
      const out =
        typeof flags.out === "string" ? flags.out : path.join(prefix, "opencode.jsonc")
      await runConfig({
        prefix,
        out,
        onlyInstalled: flags["only-installed"] === true,
        ...(typeof flags.merge === "string" ? { merge: flags.merge } : {}),
      })
      return
    }

    case "list": {
      printList(flags.verbose === true)
      return
    }

    default:
      console.error(`Unknown command: ${cmd}`)
      usage()
  }
}

function printList(verbose: boolean): void {
  const bundleable = bundleableEntries()
  const toolchain = toolchainEntries()

  console.log(`BUNDLEABLE (${bundleable.length}) — shipped in the offline bundle:\n`)
  for (const e of bundleable) {
    const kinds = Object.values(e.source)
      .map((s) => (s ? s.kind : "?"))
      .filter((k, i, a) => a.indexOf(k) === i)
      .join(",")
    console.log(`  ${e.id.padEnd(26)} [${kinds}] ${e.description}`)
    if (verbose && e.notes) console.log(`      ${e.notes}`)
  }

  console.log(`\nTOOLCHAIN-ONLY (${toolchain.length}) — requires language SDK on target:\n`)
  for (const e of toolchain) {
    console.log(`  ${e.id.padEnd(26)} ${e.description}`)
    if (verbose) {
      const src = e.source["*"]
      if (src && src.kind === "toolchain") console.log(`      ${src.install}`)
    }
  }

  console.log(`\nTotal: ${REGISTRY.length} LSPs`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
