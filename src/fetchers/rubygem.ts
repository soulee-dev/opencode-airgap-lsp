/**
 * RubyGems.org .gem fetcher (used for rubocop → ruby-lsp).
 *
 * The target machine runs `gem install --local <file>.gem --bindir <prefix>/ruby-lsp/bin`
 * to register the LSP command. Ruby must be installed on the target.
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download, fetchJson } from "./util.ts"

interface RubygemsVersion {
  version: string
}

export async function fetchRubyGem(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "rubygem" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  let version = source.version
  if (!version || version === "latest") {
    const info = await fetchJson<RubygemsVersion>(`https://rubygems.org/api/v1/versions/${source.gem}/latest.json`)
    version = info.version
  }
  const filename = `${source.gem}-${version}.gem`
  const url = `https://rubygems.org/gems/${filename}`
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(url, dest)
  return {
    id,
    target,
    url,
    filename,
    // A .gem file is a custom tar format; we leave extraction to `gem install --local`.
    format: "none",
    version,
    sha256,
    size,
  }
}
