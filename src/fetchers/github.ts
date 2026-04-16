/**
 * GitHub release asset fetcher + GitHub source-zip fetcher.
 *
 * `github-release`: resolves latest (or pinned) tag, finds the matching asset by name
 * (with `{version}` substitution), and downloads it.
 *
 * `github-zip`: downloads a source archive from `archive/refs/heads/<ref>.zip`.
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download, fetchJson, githubHeaders } from "./util.ts"

interface GithubRelease {
  tag_name: string
  name?: string | null
  assets: Array<{ name: string; browser_download_url: string }>
}

export async function resolveRelease(repo: string, tag?: string): Promise<GithubRelease> {
  const url =
    tag && tag !== "latest"
      ? `https://api.github.com/repos/${repo}/releases/tags/${tag}`
      : `https://api.github.com/repos/${repo}/releases/latest`
  return fetchJson<GithubRelease>(url, { headers: githubHeaders() })
}

export async function fetchGithubRelease(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "github-release" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const release = await resolveRelease(source.repo, source.tag)
  const version = release.tag_name.replace(/^v/, "")
  const expected = source.asset.replace("{version}", version)

  const asset = release.assets.find((a) => a.name === expected)
  if (!asset) {
    const available = release.assets.map((a) => a.name).join(", ")
    throw new Error(
      `GitHub release asset not found for ${id} (${target.platform}-${target.arch}): wanted "${expected}" in ${source.repo}@${release.tag_name}. Available: ${available}`,
    )
  }

  const dest = path.join(destDir, asset.name)
  const { size, sha256 } = await download(asset.browser_download_url, dest)
  return {
    id,
    target,
    url: asset.browser_download_url,
    filename: asset.name,
    format: source.format,
    version,
    sha256,
    size,
  }
}

export async function fetchGithubZip(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "github-zip" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const url = `https://github.com/${source.repo}/archive/refs/heads/${source.ref}.zip`
  const filename = `${source.repo.replaceAll("/", "-")}-${source.ref}.zip`
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(url, dest)
  return {
    id,
    target,
    url,
    filename,
    format: "zip",
    version: source.ref,
    sha256,
    size,
    ...(source.postExtract ? { postExtract: source.postExtract } : {}),
  }
}
