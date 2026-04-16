/**
 * Eclipse JDTLS fetcher. Single platform-agnostic tarball.
 */

import path from "node:path"
import type { Source, Target, FetchedArtifact } from "../types.ts"
import { download } from "./util.ts"

export async function fetchJdtls(
  id: string,
  target: Target,
  source: Extract<Source, { kind: "eclipse-jdtls" }>,
  destDir: string,
): Promise<FetchedArtifact> {
  const filename = "jdt-language-server-latest.tar.gz"
  const dest = path.join(destDir, filename)
  const { size, sha256 } = await download(source.url, dest)
  return {
    id,
    target,
    url: source.url,
    filename,
    format: "tar.gz",
    // Eclipse's "latest snapshot" URL doesn't expose a version string. We stamp the date
    // so the manifest is at least distinguishable across fetches.
    version: new Date().toISOString().slice(0, 10),
    sha256,
    size,
  }
}
