/**
 * HashiCorp releases API fetcher (used for terraform-ls).
 *
 * API reference: https://api.releases.hashicorp.com/v1/releases
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download, fetchJson } from "./util.ts"

interface HashicorpRelease {
  version: string
  builds: Array<{ arch: string; os: string; url: string }>
}

export async function fetchHashicorp(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "hashicorp" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const versionSeg = source.version && source.version !== "latest" ? source.version : "latest"
  const url = `https://api.releases.hashicorp.com/v1/releases/${source.product}/${versionSeg}`
  const release = await fetchJson<HashicorpRelease>(url)

  // HashiCorp naming: amd64 / arm64, windows / linux / darwin
  const hcArch = target.arch === "arm64" ? "arm64" : "amd64"
  const hcOs = target.platform === "win32" ? "windows" : target.platform
  const build = release.builds.find((b) => b.arch === hcArch && b.os === hcOs)
  if (!build) {
    throw new Error(`No HashiCorp build for ${source.product} on ${hcOs}/${hcArch} (version ${release.version})`)
  }

  const filename = build.url.split("/").pop() ?? `${source.product}_${release.version}_${hcOs}_${hcArch}.zip`
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(build.url, dest)
  return {
    id,
    target,
    url: build.url,
    filename,
    format: "zip",
    version: release.version,
    sha256,
    size,
  }
}
