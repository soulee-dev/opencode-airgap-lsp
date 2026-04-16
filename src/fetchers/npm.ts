/**
 * npm registry fetcher.
 *
 * Fetches the package tarball from registry.npmjs.org and, for packages with
 * platform-specific native sub-packages (biome, oxlint), also fetches the matching
 * `optionalDependencies` nupkg for the target.
 *
 * Layout written to destDir:
 *   <sanitized-pkg>-<version>.tgz          (main package)
 *   <sanitized-native>-<version>.tgz        (optional native, if applicable)
 *
 * The installer is responsible for extracting these into the correct node_modules layout.
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download, fetchJson } from "./util.ts"

interface PackumentVersion {
  version: string
  dist: { tarball: string; shasum?: string; integrity?: string }
  optionalDependencies?: Record<string, string>
}

async function resolvePackument(pkg: string, version?: string): Promise<PackumentVersion> {
  const spec = version && version !== "latest" ? version : "latest"
  // The "/<pkg>/<version>" endpoint returns a single version document.
  return fetchJson<PackumentVersion>(`https://registry.npmjs.org/${pkg}/${spec}`)
}

function sanitizePkgName(pkg: string): string {
  return pkg.replace(/^@/, "").replaceAll("/", "_")
}

export async function fetchNpm(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "npm" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const manifest = await resolvePackument(source.pkg, source.version)
  const tarballUrl = manifest.dist.tarball
  const filename = `${sanitizePkgName(source.pkg)}-${manifest.version}.tgz`
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(tarballUrl, dest)

  const extras: NonNullable<FetchedArtifact["extras"]> = []

  if (source.optionalNatives) {
    const { nameTemplate, platformMap, archMap } = source.optionalNatives
    const plat = platformMap?.[target.platform] ?? target.platform
    const arch = archMap?.[target.arch] ?? target.arch
    const nativeName = nameTemplate.replace("{platform}", plat).replace("{arch}", arch)

    // Prefer the version declared by the main package's optionalDependencies
    // so the main+native pair matches. Fall back to "latest" otherwise.
    const nativeVersion = manifest.optionalDependencies?.[nativeName] ?? "latest"
    const nativeManifest = await resolvePackument(nativeName, nativeVersion)
    const nativeFilename = `${sanitizePkgName(nativeName)}-${nativeManifest.version}.tgz`
    const nativeDest = path.join(destDir, nativeFilename)
    const { size: ns, sha256: nsha } = await download(nativeManifest.dist.tarball, nativeDest)
    extras.push({
      filename: nativeFilename,
      url: nativeManifest.dist.tarball,
      sha256: nsha,
      size: ns,
    })
  }

  return {
    id,
    target,
    url: tarballUrl,
    filename,
    format: "tgz",
    version: manifest.version,
    sha256,
    size,
    ...(extras.length > 0 ? { extras } : {}),
  }
}
