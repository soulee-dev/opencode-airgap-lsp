/**
 * `oalsp install` — extract a bundle tar.gz on the air-gapped target and place
 * each LSP's files at the correct path under <prefix>.
 *
 * Flow:
 *   1. Extract <bundle>.tar.gz to a staging dir. We now have:
 *        <stage>/raw/*.{zip,tar.gz,tar.xz,tgz,nupkg,gem,gz}
 *        <stage>/manifest.json
 *   2. Verify each artifact's SHA-256 against the manifest.
 *   3. For each artifact, dispatch to a per-LSP handler (by id) or a format default.
 *      The handler is responsible for placing files so that the binPath recorded in the
 *      registry resolves correctly under <prefix>.
 *
 * Layout on completion:
 *   <prefix>/<id>/...   (binaries and support files)
 *   <prefix>/manifest.installed.json   (summary of what was installed)
 *
 * Flags:
 *   --bundle <file>   Required: path to opencode-lsp-bundle-<plat>-<arch>-<date>.tar.gz
 *   --prefix <dir>    Install prefix (default: ~/.opencode-lsp)
 *   --skip-verify     Skip sha256 verification (not recommended)
 *   --only <ids>      Only install these LSPs
 *   --skip <ids>      Skip these LSPs
 *   --stage <dir>     Staging dir for the extracted bundle (default: <prefix>/.stage)
 */

import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { mkdir, readFile, writeFile, rm, stat, readdir, copyFile, rename, chmod, mkdtemp } from "node:fs/promises"
import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { pipeline } from "node:stream/promises"
import { createGunzip } from "node:zlib"

/**
 * On Windows, `tar` on PATH is often MSYS/Cygwin's GNU tar, which parses any
 * argument containing ":" as a remote host (rsh-style). That breaks on Windows paths
 * like `C:\...`. The builtin `C:\Windows\System32\tar.exe` is bsdtar and handles
 * Windows paths correctly. Prefer it when present.
 */
const TAR_BIN: string = (() => {
  if (process.platform !== "win32") return "tar"
  const sys32 = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe")
  return existsSync(sys32) ? sys32 : "tar"
})()
import type { FetchedArtifact, Target, TargetManifest } from "../types.ts"
import { entryById } from "../registry.ts"
import { humanBytes } from "../fetchers/util.ts"

export interface InstallOptions {
  bundle: string
  prefix: string
  stage?: string
  skipVerify?: boolean
  only?: string[]
  skip?: string[]
}

interface InstalledRecord {
  id: string
  version: string
  binPath: string
  installedAt: string
}

export async function runInstall(opts: InstallOptions): Promise<void> {
  const prefix = path.resolve(opts.prefix)
  const stage = path.resolve(opts.stage ?? path.join(prefix, ".stage"))

  console.log(`Installing bundle: ${opts.bundle}`)
  console.log(`Prefix:  ${prefix}`)
  console.log(`Stage:   ${stage}`)
  console.log()

  await mkdir(prefix, { recursive: true })
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })

  // 1. Extract bundle
  console.log("━━━ extracting bundle")
  await extractTar(path.resolve(opts.bundle), stage, "gz")

  // 2. Load manifest
  const manifestPath = path.join(stage, "manifest.json")
  const manifest: TargetManifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const rawDir = path.join(stage, "raw")
  console.log(`  ✓ bundle for ${manifest.target.platform}-${manifest.target.arch}`)
  console.log(`  ✓ ${manifest.artifacts.length} artifacts recorded`)
  console.log()

  // 3. Filter
  const onlySet = opts.only && opts.only.length > 0 ? new Set(opts.only) : undefined
  const skipSet = opts.skip && opts.skip.length > 0 ? new Set(opts.skip) : undefined
  const selected = manifest.artifacts.filter((a) => {
    if (onlySet && !onlySet.has(a.id)) return false
    if (skipSet && skipSet.has(a.id)) return false
    return true
  })

  // 4. Verify + install
  const installed: InstalledRecord[] = []
  const failed: Array<{ id: string; reason: string }> = []

  for (const artifact of selected) {
    const start = Date.now()
    try {
      if (!opts.skipVerify) await verifyArtifact(rawDir, artifact)
      const binPath = await installArtifact(artifact, rawDir, prefix, manifest.target)
      installed.push({
        id: artifact.id,
        version: artifact.version,
        binPath,
        installedAt: new Date().toISOString(),
      })
      const ms = Date.now() - start
      console.log(`  ✓ ${artifact.id.padEnd(24)} v${artifact.version.padEnd(12)} → ${path.relative(prefix, binPath)} (${ms}ms)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ id: artifact.id, reason: msg })
      console.error(`  ✗ ${artifact.id.padEnd(24)} FAILED: ${msg}`)
    }
  }

  // 5. Write summary
  const installedManifest = {
    prefix,
    target: manifest.target,
    installedAt: new Date().toISOString(),
    installed,
    failed,
  }
  await writeFile(
    path.join(prefix, "manifest.installed.json"),
    JSON.stringify(installedManifest, null, 2),
  )

  // 6. Cleanup stage
  await rm(stage, { recursive: true, force: true })

  console.log()
  console.log(`━━━ done: ${installed.length} installed, ${failed.length} failed`)
  console.log(`Run: oalsp config --prefix ${prefix} --out opencode.jsonc`)
}

async function verifyArtifact(rawDir: string, artifact: FetchedArtifact): Promise<void> {
  const file = path.join(rawDir, artifact.filename)
  const actual = await sha256OfFile(file)
  if (actual !== artifact.sha256) {
    throw new Error(`SHA256 mismatch for ${artifact.filename}: expected ${artifact.sha256}, got ${actual}`)
  }
  for (const extra of artifact.extras ?? []) {
    const exfile = path.join(rawDir, extra.filename)
    const exActual = await sha256OfFile(exfile)
    if (exActual !== extra.sha256) {
      throw new Error(`SHA256 mismatch for ${extra.filename}: expected ${extra.sha256}, got ${exActual}`)
    }
  }
}

/**
 * Place `artifact` at its final location under `prefix` and return the absolute bin path.
 */
async function installArtifact(
  artifact: FetchedArtifact,
  rawDir: string,
  prefix: string,
  target: Target,
): Promise<string> {
  const entry = entryById(artifact.id)
  if (!entry) throw new Error(`Unknown LSP id in manifest: ${artifact.id}`)

  const binKey = `${target.platform}-${target.arch}` as const
  const binTemplate = entry.binPath[binKey] ?? entry.binPath["*"]
  if (!binTemplate) throw new Error(`No binPath defined for ${entry.id} on ${binKey}`)

  const ext = target.platform === "win32" ? ".exe" : ""
  const finalBinRel = binTemplate.replace("{version}", artifact.version).replace("{ext}", ext)
  const finalBin = path.join(prefix, finalBinRel)

  const srcFile = path.join(rawDir, artifact.filename)
  const destDir = path.join(prefix, artifact.id)
  await mkdir(destDir, { recursive: true })

  // Dispatch by special id first, then fall back to format-based extraction.
  switch (artifact.id) {
    case "biome":
    case "oxlint":
      await installNpmWithNative(artifact, rawDir, destDir)
      break

    case "jdtls":
      await extractTarGz(srcFile, destDir)
      await writeJdtlsLauncher(destDir, target)
      break

    case "tinymist":
      // tinymist tar.gz has a top-level dir we strip; zips extract flat.
      if (artifact.filename.endsWith(".tar.gz") || artifact.filename.endsWith(".tgz")) {
        await extractTarStrip(srcFile, destDir, 1)
      } else {
        await extractZip(srcFile, destDir)
      }
      break

    case "elixir-ls":
      // prebuilt github release zip contains a versioned top dir — flatten it.
      await extractZipFlat(srcFile, destDir)
      break

    case "eslint":
      // github-zip: extract and leave postExtract to the user
      // (vscode-eslint's npm install + compile must be run on a machine with npm).
      await extractZipFlat(srcFile, destDir)
      console.warn(
        `    NOTE: eslint requires a manual post-install step: (cd ${destDir} && npm install --omit=dev && npm run compile)`,
      )
      break

    case "csharp":
    case "fsharp":
      // .nupkg is a zip. Extract to a tools staging dir, then use `dotnet tool install`
      // with a local feed pointing at the raw dir.
      await installDotnetTool(artifact, rawDir, destDir, target)
      break

    case "ruby-lsp":
      // .gem install via `gem install --local`.
      await installRubyGem(artifact, rawDir, destDir, target)
      break

    case "rust":
      // rust-analyzer for linux/mac is a single gzipped binary (not tar.gz).
      // Windows is a normal zip.
      if (artifact.filename.endsWith(".gz") && !artifact.filename.endsWith(".tar.gz")) {
        await gunzipToFile(srcFile, finalBin)
      } else {
        await extractByFormat(srcFile, destDir, artifact.filename)
      }
      break

    default:
      await extractByFormat(srcFile, destDir, artifact.filename)
  }

  // Ensure the recorded bin is executable on unix (no-op on Windows).
  // Some handlers (dotnet tool install, gem install) produce scripts that are already +x,
  // but extracted tarballs may preserve modes incorrectly across filesystems.
  await chmodExec(finalBin).catch(() => {})

  return finalBin
}

// ────────────────────────────────────────────────────────────────────────────
// Extractors
// ────────────────────────────────────────────────────────────────────────────

async function extractByFormat(archive: string, dest: string, filename: string): Promise<void> {
  if (filename.endsWith(".tar.gz") || filename.endsWith(".tgz")) {
    await extractTar(archive, dest, "gz")
  } else if (filename.endsWith(".tar.xz")) {
    await extractTar(archive, dest, "xz")
  } else if (filename.endsWith(".zip") || filename.endsWith(".nupkg")) {
    await extractZip(archive, dest)
  } else if (filename.endsWith(".gz")) {
    // Single gzipped file — caller likely wants custom handling; default is noop here.
    throw new Error(`Single-gz artifact needs a dedicated handler: ${filename}`)
  } else {
    // Assume a bare binary — copy.
    const outName = path.basename(archive)
    await copyFile(archive, path.join(dest, outName))
  }
}

/**
 * Run `tar -x` with Windows-safe argument handling.
 *
 * GNU tar parses `-f <path>` as `host:path` when the path contains a colon (e.g. "C:\…"),
 * which breaks on Windows. Workaround: cd into the directory containing the archive and
 * pass the bare filename via -f. The destination (-C) can still be absolute because -C
 * doesn't trigger that parsing path.
 */
async function extractTar(archive: string, dest: string, compression: "gz" | "xz"): Promise<void> {
  const absArchive = path.resolve(archive)
  const absDest = path.resolve(dest)
  const flag = compression === "gz" ? "-xzf" : "-xJf"
  await execCmdIn(path.dirname(absArchive), TAR_BIN, [flag, path.basename(absArchive), "-C", absDest])
}

async function extractTarStrip(archive: string, dest: string, stripComponents: number): Promise<void> {
  const absArchive = path.resolve(archive)
  const absDest = path.resolve(dest)
  await execCmdIn(path.dirname(absArchive), TAR_BIN, [
    "-xzf",
    path.basename(absArchive),
    `--strip-components=${stripComponents}`,
    "-C",
    absDest,
  ])
}

async function extractZip(archive: string, dest: string): Promise<void> {
  // `unzip` is near-universal on Linux/macOS. On Windows we use bsdtar (ships with Win10+),
  // which supports zip natively, via the same Windows-safe wrapper.
  const absArchive = path.resolve(archive)
  const absDest = path.resolve(dest)
  if (process.platform === "win32") {
    await execCmdIn(path.dirname(absArchive), TAR_BIN, ["-xf", path.basename(absArchive), "-C", absDest])
  } else {
    await execCmd("unzip", ["-q", "-o", absArchive, "-d", absDest])
  }
}

/** Extract a zip and then strip the single top-level directory (if any) from the result. */
async function extractZipFlat(archive: string, dest: string): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "oalsp-zip-"))
  try {
    await extractZip(archive, tmp)
    const kids = await readdir(tmp, { withFileTypes: true })
    // If there's a single top-level directory, merge its contents into dest.
    if (kids.length === 1 && kids[0]!.isDirectory()) {
      await moveDirContents(path.join(tmp, kids[0]!.name), dest)
    } else {
      for (const k of kids) {
        await rename(path.join(tmp, k.name), path.join(dest, k.name))
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

async function extractTarGz(archive: string, dest: string): Promise<void> {
  await extractTar(archive, dest, "gz")
}

async function moveDirContents(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    await rename(path.join(src, ent.name), path.join(dest, ent.name))
  }
}

async function gunzipToFile(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true })
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest))
}

// ────────────────────────────────────────────────────────────────────────────
// Special handlers
// ────────────────────────────────────────────────────────────────────────────

/** biome / oxlint: unpack main .tgz into destDir/package, then place native .tgz under node_modules. */
async function installNpmWithNative(
  artifact: FetchedArtifact,
  rawDir: string,
  destDir: string,
): Promise<void> {
  // Extract main tarball (npm tarball has a top-level "package/" dir).
  await extractTarGz(path.join(rawDir, artifact.filename), destDir)

  // Each extra is a native subpackage.
  for (const extra of artifact.extras ?? []) {
    // Derive the target node_modules dir from the sanitized filename.
    // filename pattern: "<scope>_<name>-<version>.tgz" → scope/name
    const baseName = extra.filename.replace(/-\d.*\.tgz$/, "")
    const scopeIdx = baseName.indexOf("_")
    const modulePath =
      scopeIdx >= 0
        ? path.join("@" + baseName.slice(0, scopeIdx), baseName.slice(scopeIdx + 1))
        : baseName
    const nmDir = path.join(destDir, "package", "node_modules", modulePath)
    await mkdir(nmDir, { recursive: true })

    const tmp = await mkdtemp(path.join(os.tmpdir(), "oalsp-native-"))
    try {
      await extractTarGz(path.join(rawDir, extra.filename), tmp)
      // The tgz extracts as tmp/package/... — merge those files into nmDir.
      await moveDirContents(path.join(tmp, "package"), nmDir)
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  // Mark the main binary as executable on unix.
  // (The actual bin file path is derived by caller; handled post-return.)
}

/** Write a stable launcher script for jdtls so the opencode config doesn't hardcode a launcher jar name. */
async function writeJdtlsLauncher(jdtlsDir: string, target: { platform: string; arch: string }): Promise<void> {
  const pluginsDir = path.join(jdtlsDir, "plugins")
  const pluginEntries = await readdir(pluginsDir).catch(() => [])
  const launcherJar = pluginEntries.find((n) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(n))
  if (!launcherJar) throw new Error("Could not locate jdtls launcher jar under plugins/")

  const configDir =
    target.platform === "darwin" ? "config_mac" : target.platform === "win32" ? "config_win" : "config_linux"

  const javaArgs = [
    `-jar "${path.join(jdtlsDir, "plugins", launcherJar)}"`,
    `-configuration "${path.join(jdtlsDir, configDir)}"`,
    `-data "${path.join(jdtlsDir, "workspace")}"`,
    "-Declipse.application=org.eclipse.jdt.ls.core.id1",
    "-Dosgi.bundles.defaultStartLevel=4",
    "-Declipse.product=org.eclipse.jdt.ls.core.product",
    "-Dlog.level=ALL",
    "--add-modules=ALL-SYSTEM",
    "--add-opens java.base/java.util=ALL-UNNAMED",
    "--add-opens java.base/java.lang=ALL-UNNAMED",
  ]

  if (target.platform === "win32") {
    const cmd = ["@echo off", `java ${javaArgs.join(" ")} %*`].join("\r\n")
    await writeFile(path.join(jdtlsDir, "jdtls-launcher.cmd"), cmd)
  } else {
    const sh = ["#!/usr/bin/env bash", "set -e", `exec java ${javaArgs.join(" ")} "$@"`].join("\n")
    const p = path.join(jdtlsDir, "jdtls-launcher.sh")
    await writeFile(p, sh)
    await chmod(p, 0o755)
  }
}

async function installDotnetTool(
  artifact: FetchedArtifact,
  rawDir: string,
  destDir: string,
  target: { platform: string; arch: string },
): Promise<void> {
  const toolPath = path.join(destDir)
  await mkdir(toolPath, { recursive: true })
  // dotnet tool install with a local source directory that contains the .nupkg.
  const pkgId = artifact.id === "csharp" ? "csharp-ls" : "fsautocomplete"
  await execCmd("dotnet", [
    "tool",
    "install",
    pkgId,
    "--tool-path",
    toolPath,
    "--add-source",
    rawDir,
    "--version",
    artifact.version,
    "--ignore-failed-sources",
  ])
  void target // platform-specific exe suffix is applied by registry binPath templates
}

async function installRubyGem(
  artifact: FetchedArtifact,
  rawDir: string,
  destDir: string,
  target: { platform: string; arch: string },
): Promise<void> {
  const gemFile = path.join(rawDir, artifact.filename)
  const binDir = path.join(destDir, "bin")
  const libDir = path.join(destDir, "lib")
  await mkdir(binDir, { recursive: true })
  await mkdir(libDir, { recursive: true })
  await execCmd("gem", [
    "install",
    "--local",
    gemFile,
    "--bindir",
    binDir,
    "--install-dir",
    libDir,
    "--no-document",
  ])
  void target
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function execCmd(cmd: string, args: string[]): Promise<void> {
  return execCmdIn(process.cwd(), cmd, args)
}

function execCmdIn(cwd: string, cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd })
    const stderr: Buffer[] = []
    proc.stderr.on("data", (d: Buffer) => stderr.push(d))
    proc.on("error", (err) => reject(new Error(`${cmd}: ${err.message}`)))
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `${cmd} ${args.join(" ")} exited ${code}${
              stderr.length ? "\n" + Buffer.concat(stderr).toString().slice(0, 2048) : ""
            }`,
          ),
        )
    })
  })
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = crypto.createHash("sha256")
  const stream = createReadStream(file)
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
  return hash.digest("hex")
}

async function chmodExec(file: string): Promise<void> {
  if (process.platform === "win32") return
  const st = await stat(file).catch(() => undefined)
  if (!st) return
  await chmod(file, 0o755)
}
