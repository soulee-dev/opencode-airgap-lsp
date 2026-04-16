/**
 * `oalsp bundle` — pack the fetched per-target directory into a single tar.gz.
 *
 * Input:
 *   <work>/<platform>-<arch>/raw/*
 *   <work>/<platform>-<arch>/manifest.json
 *
 * Output:
 *   <out>/opencode-lsp-bundle-<platform>-<arch>-<date>.tar.gz
 *
 * We shell out to the system `tar` (available on Linux, macOS, and Windows 10+).
 * This avoids bringing in a tar implementation as a dependency and stays air-gapped-friendly.
 *
 * Flags:
 *   --work <dir>      Input dir produced by `fetch` (default: ./work)
 *   --out <dir>       Bundle output dir (default: ./bundles)
 *   --targets <list>  Which targets to bundle (default: all found under <work>)
 */

import path from "node:path"
import { mkdir, readdir, stat, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import type { Target, TargetManifest } from "../types.ts"
import { humanBytes } from "../fetchers/util.ts"

/** Prefer Windows' native bsdtar to avoid MSYS GNU tar's host:path parsing. */
const TAR_BIN: string = (() => {
  if (process.platform !== "win32") return "tar"
  const sys32 = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe")
  return existsSync(sys32) ? sys32 : "tar"
})()

export interface BundleOptions {
  work: string
  out: string
  targets?: Target[]
}

export async function runBundle(opts: BundleOptions): Promise<void> {
  await mkdir(opts.out, { recursive: true })
  const targets = opts.targets ?? (await discoverTargets(opts.work))
  if (targets.length === 0) {
    console.error(`No targets found under ${opts.work}. Run 'oalsp fetch' first.`)
    process.exit(1)
  }

  console.log(`Bundling ${targets.length} target(s) from ${path.resolve(opts.work)}`)
  console.log(`Output:  ${path.resolve(opts.out)}`)
  console.log()

  for (const target of targets) {
    await bundleTarget(target, opts)
  }
}

async function discoverTargets(workDir: string): Promise<Target[]> {
  const entries = await readdir(workDir, { withFileTypes: true }).catch(() => [])
  const targets: Target[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const m = /^(win32|linux|darwin)-(x64|arm64)$/.exec(ent.name)
    if (!m) continue
    // Verify manifest exists
    const manifestPath = path.join(workDir, ent.name, "manifest.json")
    const ok = await stat(manifestPath).then(
      () => true,
      () => false,
    )
    if (!ok) continue
    targets.push({ platform: m[1] as Target["platform"], arch: m[2] as Target["arch"] })
  }
  return targets
}

async function bundleTarget(target: Target, opts: BundleOptions): Promise<void> {
  const label = `${target.platform}-${target.arch}`
  const srcDir = path.join(opts.work, label)
  const manifestPath = path.join(srcDir, "manifest.json")
  const manifest: TargetManifest = JSON.parse(await readFile(manifestPath, "utf8"))

  const date = new Date().toISOString().slice(0, 10)
  const bundleName = `opencode-lsp-bundle-${label}-${date}.tar.gz`
  const absOut = path.resolve(opts.out)
  const bundlePath = path.join(absOut, bundleName)

  console.log(`━━━ [${label}] packing ${manifest.artifacts.length} artifacts`)

  // Run tar with cwd=<out> so the output filename is a bare name. GNU tar on Windows
  // otherwise interprets "C:\path.tar.gz" as host:path (rsh-style). Input path still
  // needs to be absolute; it's passed via -C which doesn't trigger that parsing.
  await execTar(["-czf", bundleName, "-C", path.resolve(srcDir), "raw", "manifest.json"], absOut)

  const size = (await stat(bundlePath)).size
  console.log(`  ✓ ${bundleName} (${humanBytes(size)})`)
  console.log()
}

function execTar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TAR_BIN, args, { stdio: "inherit", cwd })
    proc.on("error", (err) => reject(new Error(`Failed to invoke tar: ${err.message}`)))
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with code ${code}`))
    })
  })
}
