/**
 * NuGet v3 flat-container fetcher for .NET tools (csharp-ls, fsautocomplete).
 *
 * We download the raw .nupkg (it's a zip archive). On the target machine,
 * the installer extracts it and uses `dotnet tool install --add-source <dir>`
 * to register the tool, then exposes the binary.
 *
 * NuGet v3 flat container API:
 *   GET /v3-flatcontainer/{lower-id}/index.json  -> { versions: [...] }
 *   GET /v3-flatcontainer/{lower-id}/{ver}/{lower-id}.{ver}.nupkg
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download, fetchJson } from "./util.ts"

interface NugetIndex {
  versions: string[]
}

export async function fetchDotnetTool(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "dotnet-tool" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const pkgLower = source.pkg.toLowerCase()
  let version = source.version
  if (!version || version === "latest") {
    const idx = await fetchJson<NugetIndex>(`https://api.nuget.org/v3-flatcontainer/${pkgLower}/index.json`)
    if (!idx.versions.length) throw new Error(`NuGet index empty for ${source.pkg}`)
    // Filter out prerelease versions (those containing "-") unless nothing else is available.
    const stable = idx.versions.filter((v) => !v.includes("-"))
    version = (stable.length > 0 ? stable : idx.versions).at(-1)!
  }
  const filename = `${pkgLower}.${version}.nupkg`
  const url = `https://api.nuget.org/v3-flatcontainer/${pkgLower}/${version}/${filename}`
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(url, dest)
  return {
    id,
    target,
    url,
    filename,
    // .nupkg is a zip under the hood; the installer can unzip it directly.
    format: "zip",
    version,
    sha256,
    size,
  }
}
