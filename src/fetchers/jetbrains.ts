/**
 * JetBrains Kotlin LSP fetcher.
 *
 * Version is discovered via the Kotlin/kotlin-lsp GitHub releases (the `name` field),
 * then the actual archive is pulled from download-cdn.jetbrains.com.
 * This mirrors opencode's own download logic in server.ts:1212-1260.
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download, fetchJson, githubHeaders } from "./util.ts"

interface GithubRelease {
  tag_name: string
  name?: string | null
}

export async function fetchKotlinLsp(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "jetbrains-kotlin-lsp" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const versionUrl =
    source.version && source.version !== "latest"
      ? `https://api.github.com/repos/${source.versionRepo}/releases/tags/${source.version}`
      : `https://api.github.com/repos/${source.versionRepo}/releases/latest`

  const release = await fetchJson<GithubRelease>(versionUrl, { headers: githubHeaders() })
  const version = (release.name ?? release.tag_name).replace(/^v/, "")
  if (!version) throw new Error(`Could not resolve kotlin-lsp version from ${source.versionRepo}`)

  // Platform/arch mapping per server.ts:1226-1243
  const kotlinPlatform =
    target.platform === "darwin" ? "mac" : target.platform === "win32" ? "win" : "linux"
  const kotlinArch = target.arch === "arm64" ? "aarch64" : "x64"

  const supported = new Set(["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"])
  const combo = `${kotlinPlatform}-${kotlinArch}`
  if (!supported.has(combo)) {
    throw new Error(`kotlin-lsp does not publish a build for ${combo}`)
  }

  const filename = `kotlin-lsp-${version}-${combo}.zip`
  const url = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${filename}`
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(url, dest)
  return {
    id,
    target,
    url,
    filename,
    format: "zip",
    version,
    sha256,
    size,
  }
}
