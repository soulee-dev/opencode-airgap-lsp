/**
 * Shared fetcher utilities: streaming download with SHA-256 accumulation,
 * retry/backoff, and consistent error messages.
 */

import crypto from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"

export interface DownloadResult {
  size: number
  sha256: string
}

/** Cheap ANSI coloring for progress lines. Disabled if NO_COLOR is set. */
const noColor = !!process.env.NO_COLOR
const dim = (s: string) => (noColor ? s : `\x1b[2m${s}\x1b[0m`)

/** Stream-download a URL to `dest`, computing sha256 on the fly. */
export async function download(
  url: string,
  dest: string,
  opts: { headers?: Record<string, string>; retries?: number } = {},
): Promise<DownloadResult> {
  const retries = opts.retries ?? 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await downloadOnce(url, dest, opts.headers)
    } catch (err) {
      lastErr = err
      if (attempt < retries) {
        const delayMs = 500 * attempt
        process.stderr.write(dim(`  retry ${attempt}/${retries - 1} after ${delayMs}ms: ${url}\n`))
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw lastErr
}

async function downloadOnce(url: string, dest: string, headers?: Record<string, string>): Promise<DownloadResult> {
  await mkdir(path.dirname(dest), { recursive: true })
  const res = await fetch(url, { headers, redirect: "follow" })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
  }
  if (!res.body) {
    throw new Error(`Empty response body for ${url}`)
  }

  const hash = crypto.createHash("sha256")
  let size = 0

  // Tap the web stream into node's stream pipeline so we can pipe to disk
  // and feed the hasher simultaneously without buffering the whole payload.
  const nodeStream = Readable.fromWeb(
    new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            hash.update(value)
            size += value.byteLength
            controller.enqueue(value)
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    }),
  )

  const fileStream = createWriteStream(dest)
  await pipeline(nodeStream, fileStream)

  return { size, sha256: hash.digest("hex") }
}

/** Fetch JSON with retry. */
export async function fetchJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; retries?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: opts.headers, redirect: "follow" })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
      return (await res.json()) as T
    } catch (err) {
      lastErr = err
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
  }
  throw lastErr
}

/** Common GitHub API headers (optionally authenticated via GITHUB_TOKEN). */
export function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "opencode-airgap-lsp",
  }
  const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"]
  if (token) h["Authorization"] = `Bearer ${token}`
  return h
}

/** Format bytes as "1.23 MB" / "456 KB" etc. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
