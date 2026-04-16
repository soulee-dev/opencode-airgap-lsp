/**
 * Core types for opencode-airgap-lsp.
 *
 * Design principles:
 * - `fetch` runs on an internet-connected machine and downloads *raw archives* per target platform/arch.
 *   We do NOT extract on the fetch side — extraction is deferred to the target machine during `install`.
 *   This keeps the fetch side platform-agnostic and avoids needing tar.xz/tar.gz/zip extractors everywhere.
 * - `bundle` packs the fetched artifacts into a single tar.gz per platform+arch for transfer.
 * - `install` runs on the air-gapped machine, extracts each artifact to its final location under a prefix.
 * - `config` emits an opencode.jsonc that points opencode at the installed binaries.
 *
 * Registry entries describe, per (platform, arch):
 *   1. Where to download the raw artifact from (source)
 *   2. What the artifact looks like after extraction (layout)
 *   3. How opencode should invoke the resulting binary (command template)
 */

export type Platform = "win32" | "linux" | "darwin"
export type Arch = "x64" | "arm64"

export interface Target {
  platform: Platform
  arch: Arch
}

export const ALL_TARGETS: readonly Target[] = [
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
] as const

/** Archive format of the downloaded artifact. "none" means the download is a single bare binary. */
export type ArchiveFormat = "zip" | "tar.gz" | "tar.xz" | "tgz" | "none"

/**
 * Source descriptors — how to locate and download the raw artifact for a given target.
 *
 * Each variant captures enough info for the corresponding fetcher to:
 *   a) resolve the effective version (usually "latest")
 *   b) produce a concrete download URL + asset filename
 */
export type Source =
  /** GitHub releases asset. */
  | {
      kind: "github-release"
      /** e.g. "clangd/clangd" */
      repo: string
      /** Tag selection. "latest" or a pinned tag like "v19.1.2". */
      tag?: string
      /**
       * Asset name for this (platform, arch). May include {version} placeholder
       * which is substituted with the resolved tag (with leading "v" stripped).
       */
      asset: string
      /** Archive format of the asset. */
      format: ArchiveFormat
    }
  /** npm package tarball from registry.npmjs.org. Platform-agnostic unless `optionalNatives` is set. */
  | {
      kind: "npm"
      /** Package name, e.g. "typescript-language-server" or "@vue/language-server". */
      pkg: string
      /** Version spec. "latest" or a pinned semver. */
      version?: string
      /**
       * For packages with platform-specific native addons (biome, oxlint),
       * list optional dependencies that need to be downloaded per target.
       * The fetcher will resolve each and download the matching native subpackage.
       */
      optionalNatives?: {
        /** Name template: "{base}-{platform}-{arch}" where placeholders are replaced. */
        nameTemplate: string
        /** Map our Platform to the npm naming. */
        platformMap?: Partial<Record<Platform, string>>
        /** Map our Arch to the npm naming. */
        archMap?: Partial<Record<Arch, string>>
      }
    }
  /** HashiCorp releases API (terraform-ls). */
  | {
      kind: "hashicorp"
      /** Product name as known to releases.hashicorp.com, e.g. "terraform-ls". */
      product: string
      version?: string
    }
  /** JetBrains CDN for kotlin-lsp. */
  | {
      kind: "jetbrains-kotlin-lsp"
      /** The GitHub repo to resolve the version from (Kotlin/kotlin-lsp). */
      versionRepo: string
      version?: string
    }
  /** Eclipse.org download (JDTLS). Platform-agnostic tarball. */
  | {
      kind: "eclipse-jdtls"
      /** Full URL (stable snapshot URL). */
      url: string
    }
  /** Direct GitHub source zip (used for vscode-eslint — requires npm install+compile after extract). */
  | {
      kind: "github-zip"
      /** Repo, e.g. "microsoft/vscode-eslint". */
      repo: string
      /** Branch or tag to download. */
      ref: string
      /** Commands to run after extraction, relative to extracted dir. */
      postExtract?: string[][]
    }
  /** dotnet tool: we grab the nupkg from nuget.org via dotnet tool download mechanism. */
  | {
      kind: "dotnet-tool"
      /** Tool package id, e.g. "csharp-ls". */
      pkg: string
      version?: string
    }
  /** rubygems .gem file download. */
  | {
      kind: "rubygem"
      gem: string
      version?: string
    }
  /**
   * Toolchain-only: no artifact to download; the LSP ships with the language toolchain
   * (deno, dart, gleam, julia, …). We still generate config entries assuming the tool is on PATH.
   */
  | {
      kind: "toolchain"
      /** Human-readable instructions shown by `oalsp list`. */
      install: string
    }

/**
 * Opencode config command template.
 *
 * The installer substitutes `{prefix}` with the install prefix, and `{ext}` with ".exe" on Windows else "".
 * The resulting array becomes the `command` field in opencode.jsonc.
 */
export type CommandTemplate = string[]

export interface LspEntry {
  /** Must match opencode's server.id exactly (see opencode/packages/opencode/src/lsp/server.ts). */
  id: string
  /** Source fetch descriptor keyed by target. Use "*" for a single descriptor that applies to all targets. */
  source: Partial<Record<`${Platform}-${Arch}` | "*", Source>>
  /**
   * Relative path to the LSP binary *after extraction/installation*, keyed by target.
   * `{ext}` is substituted with ".exe" on windows else "". `{version}` is the resolved version (no leading v).
   * If omitted for a target, opencode config is not generated for that target.
   */
  binPath: Partial<Record<`${Platform}-${Arch}` | "*", string>>
  /**
   * Opencode config command template. `{bin}` is substituted with the absolute bin path.
   * Extra args go after.
   */
  command: CommandTemplate
  /** Extensions (documentation only — opencode inherits from built-in if id matches). */
  extensions?: string[]
  /** Short human description. */
  description: string
  /** Whether this entry represents a toolchain-only LSP (not bundled). */
  toolchainOnly?: boolean
  /** Free-form notes for `oalsp list --verbose`. */
  notes?: string
  /**
   * Initialization options to merge into opencode config for this LSP.
   * Mostly mirrors opencode's server.ts defaults for parity.
   */
  initialization?: Record<string, unknown>
}

/** A single resolved download — what the fetcher writes to disk. */
export interface FetchedArtifact {
  id: string
  target: Target
  url: string
  filename: string
  format: ArchiveFormat
  version: string
  sha256: string
  size: number
  /** Extra files (e.g. native addon nupkgs for biome/oxlint). */
  extras?: Array<{ filename: string; url: string; sha256: string; size: number }>
  /** Commands to run post-extract (github-zip sources). */
  postExtract?: string[][]
}

/** Top-level manifest written to dist/{platform}-{arch}/manifest.json after fetch. */
export interface TargetManifest {
  schemaVersion: 1
  target: Target
  generatedAt: string
  /** oalsp version that produced this manifest. */
  producer: string
  artifacts: FetchedArtifact[]
  /** LSPs that were requested but could not be fetched (network error, missing asset, etc). */
  failed: Array<{ id: string; reason: string }>
  /** Toolchain-only LSPs that were skipped because they can't be bundled. */
  skippedToolchain: string[]
}

/** Output of `oalsp config` — serializable representation of opencode.jsonc. */
export interface OpencodeLspConfig {
  $schema?: string
  lsp: Record<
    string,
    | { disabled: true }
    | {
        command: string[]
        extensions?: string[]
        env?: Record<string, string>
        initialization?: Record<string, unknown>
      }
  >
}
