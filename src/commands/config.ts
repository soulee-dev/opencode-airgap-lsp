/**
 * `oalsp config` — generate opencode.jsonc that points at the installed LSP binaries.
 *
 * Reads <prefix>/manifest.installed.json (written by `install`) to know which LSPs
 * are actually present, and emits a config with:
 *   - Installed LSPs: `{ command: [...], extensions: [...], initialization: {...} }`
 *   - Toolchain-only LSPs (deno, dart, gleam, …): enabled with the toolchain binary name,
 *     unless `--only-installed` is passed (in which case they are disabled).
 *   - Everything else: explicitly `{ disabled: true }` so opencode never tries to
 *     auto-download when OPENCODE_DISABLE_LSP_DOWNLOAD is not set.
 *
 * Flags:
 *   --prefix <dir>      Required: install prefix used by `install` (default: ~/.opencode-lsp)
 *   --out <file>        Output path (default: <prefix>/opencode.jsonc)
 *   --only-installed    Disable toolchain LSPs that aren't bundled
 *   --disable-others    Emit { disabled: true } for every LSP not in the installed set (default: true)
 *   --merge <file>      Existing opencode.jsonc to merge into (preserves non-lsp keys)
 */

import path from "node:path"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { REGISTRY, entryById, toolchainEntries } from "../registry.ts"
import type { LspEntry, OpencodeLspConfig, Target } from "../types.ts"

export interface ConfigOptions {
  prefix: string
  out: string
  onlyInstalled?: boolean
  disableOthers?: boolean
  merge?: string
}

interface InstalledManifest {
  prefix: string
  target: Target
  installed: Array<{ id: string; version: string; binPath: string }>
}

export async function runConfig(opts: ConfigOptions): Promise<void> {
  const prefix = path.resolve(opts.prefix)
  const installedPath = path.join(prefix, "manifest.installed.json")
  const installedRaw = await readFile(installedPath, "utf8").catch(() => {
    throw new Error(`Missing ${installedPath}. Run 'oalsp install' first.`)
  })
  const installed: InstalledManifest = JSON.parse(installedRaw)

  const installedMap = new Map(installed.installed.map((e) => [e.id, e]))
  const lsp: OpencodeLspConfig["lsp"] = {}

  // 1. Installed bundleable LSPs
  for (const rec of installed.installed) {
    const entry = entryById(rec.id)
    if (!entry) continue
    lsp[entry.id] = buildCommandEntry(entry, rec.binPath)
  }

  // 2. Toolchain-only LSPs: enable by default (they resolve from PATH).
  for (const entry of toolchainEntries()) {
    if (lsp[entry.id]) continue
    if (opts.onlyInstalled) {
      lsp[entry.id] = { disabled: true }
    } else {
      // Toolchain entries use the unqualified binary name; opencode will spawn via which().
      lsp[entry.id] = buildToolchainEntry(entry)
    }
  }

  // 3. Everything else in registry: disable (belt-and-suspenders in case a new opencode
  //    version adds a server we don't know about — not strictly necessary but defensive).
  if (opts.disableOthers ?? true) {
    for (const entry of REGISTRY) {
      if (lsp[entry.id]) continue
      lsp[entry.id] = { disabled: true }
    }
  }

  // 4. Merge with existing config if requested.
  let finalConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    lsp,
  }
  if (opts.merge) {
    const existingRaw = await readFile(opts.merge, "utf8").catch(() => null)
    if (existingRaw) {
      const existing = parseJsonc(existingRaw)
      finalConfig = { ...existing, ...finalConfig, lsp: { ...(existing.lsp as object | undefined), ...lsp } }
    }
  }

  await mkdir(path.dirname(opts.out), { recursive: true })
  const body = serializeJsonc(finalConfig, installedMap.size)
  await writeFile(opts.out, body)

  console.log(`Wrote ${opts.out}`)
  console.log(`  installed: ${installedMap.size}`)
  console.log(`  toolchain: ${toolchainEntries().length}${opts.onlyInstalled ? " (disabled)" : ""}`)
  console.log()
  console.log("Make sure this env var is set when running opencode:")
  console.log("  OPENCODE_DISABLE_LSP_DOWNLOAD=true")
}

function buildCommandEntry(entry: LspEntry, binPath: string): OpencodeLspConfig["lsp"][string] {
  let command: string[]
  if (entry.command[0] === "__JDTLS__") {
    // JDTLS uses the wrapper script written by the installer.
    const launcher = binPath.endsWith(".cmd")
      ? binPath
      : binPath.includes("jdtls-launcher")
        ? binPath
        : path.join(binPath, process.platform === "win32" ? "jdtls-launcher.cmd" : "jdtls-launcher.sh")
    command = [launcher]
  } else {
    command = entry.command.map((tok) => tok.replace("{bin}", binPath))
  }
  const out: OpencodeLspConfig["lsp"][string] = { command }
  // We only emit `extensions` if the id is non-standard — matching built-in ids lets
  // opencode inherit extensions automatically (see config.ts:978-992 refine).
  // Since every id in our registry matches a built-in, we can safely omit extensions.
  if (entry.initialization) out.initialization = entry.initialization
  return out
}

function buildToolchainEntry(entry: LspEntry): OpencodeLspConfig["lsp"][string] {
  // Toolchain commands already use literal binary names (e.g. ["deno", "lsp"]); no {bin} template.
  const out: OpencodeLspConfig["lsp"][string] = { command: [...entry.command] }
  if (entry.initialization) out.initialization = entry.initialization
  return out
}

/** Very small JSONC serializer with a file-level header comment. */
function serializeJsonc(obj: unknown, installedCount: number): string {
  const header = [
    "// opencode.jsonc — generated by opencode-airgap-lsp",
    `// Generated at: ${new Date().toISOString()}`,
    `// Installed LSPs: ${installedCount}`,
    "// Make sure OPENCODE_DISABLE_LSP_DOWNLOAD=true is exported before launching opencode,",
    "// otherwise opencode may still hit the network for LSPs not covered here.",
    "",
  ].join("\n")
  return header + JSON.stringify(obj, null, 2) + "\n"
}

/** Minimal JSONC parser: strip line + block comments, then JSON.parse. */
function parseJsonc(src: string): Record<string, unknown> {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "")
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, "$1")
  return JSON.parse(noLine) as Record<string, unknown>
}
