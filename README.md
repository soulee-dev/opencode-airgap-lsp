# opencode-airgap-lsp

> 🇰🇷 한국어 버전: [README.ko.md](./README.ko.md)

Offline LSP bundler and installer for [opencode](https://github.com/anomalyco/opencode) in air-gapped environments.

## Why

opencode is a great agentic coding tool, but you only get the most out of it once LSPs are wired in — without them the agent is flying blind on types, references, and diagnostics.

That's a problem in places like financial institutions and other high-security shops where developers work off an internal network with no outbound internet. opencode's "just fetch the LSP on first use" model breaks there, and setting everything up by hand is miserable. `opencode-airgap-lsp` exists to make that one-time setup a two-command job.

## The problem

opencode auto-downloads Language Server binaries the first time it needs them — from GitHub releases, npm, NuGet, RubyGems, HashiCorp, Eclipse, and the JetBrains CDN. In an air-gapped network every one of those calls fails and you get an editor with no language intelligence.

You can set `OPENCODE_DISABLE_LSP_DOWNLOAD=true` to suppress the auto-install and point opencode at pre-installed binaries via `opencode.jsonc` — but doing that by hand across 36 LSPs on 6 platform/arch combinations is tedious and error-prone.

`opencode-airgap-lsp` (`oalsp`) does that for you.

## How it works

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [A] Internet-connected machine
─────────────────────────────────────────────────────────────────────────

    $ oalsp fetch
        ↓  download raw artifacts per target
    work/<platform>-<arch>/
      ├─ raw/            ← .tgz / .zip / .nupkg / .gem / .tar.xz / …
      └─ manifest.json   ← version + SHA-256 for every artifact

    $ oalsp bundle
        ↓  one tar.gz per target
    bundles/
      └─ opencode-lsp-bundle-<platform>-<arch>-<date>.tar.gz

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                 transfer the bundle (USB, internal mirror, …)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [B] Air-gapped machine
─────────────────────────────────────────────────────────────────────────

    $ oalsp install --bundle <file>.tar.gz
        ↓  verify SHA-256 + extract each LSP
    <prefix>/
      ├─ <id>/...                  ← 27 LSPs, each at its own subdir
      └─ manifest.installed.json

    $ oalsp config
        ↓  emit opencode.jsonc
    ~/.config/opencode/opencode.jsonc
      → 36 LSP entries pointing at <prefix>/<id>/...

    $ export OPENCODE_DISABLE_LSP_DOWNLOAD=true
    $ opencode     (no network calls)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **Internet side** runs `fetch` + `bundle`. No extraction happens here — the internet machine does not need to match the target OS. Typical bundle size is a few hundred MB per target.
- **Air-gapped side** runs `install` + `config`. Nothing on this side reaches the network.

## Quick start

```sh
# 1. On an internet-connected machine
git clone https://github.com/soulee-dev/opencode-airgap-lsp
cd opencode-airgap-lsp
bun install

# Download everything for every supported target (~several GB total).
bun run cli fetch

# Pack into per-target tarballs under ./bundles/
bun run cli bundle

# 2. Transfer the bundle to the air-gapped machine.
#    For Windows x64: opencode-lsp-bundle-win32-x64-<date>.tar.gz

# 3. On the air-gapped machine (same repo checkout + bun, offline is fine)
bun run cli install --bundle ./opencode-lsp-bundle-win32-x64-<date>.tar.gz

# 4. Emit opencode.jsonc pointing at the installed LSPs
bun run cli config --out ~/.config/opencode/opencode.jsonc

# 5. Make sure opencode never tries to auto-download
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
```

To trim what gets bundled — e.g. only TypeScript + Python tooling:

```sh
bun run cli fetch --targets win32-x64 --only typescript,pyright,vue
```

## Commands

### `oalsp fetch`

Downloads raw LSP artifacts for one or more targets. Run on an internet-connected machine.

| Flag | Default | Description |
|---|---|---|
| `--out <dir>` | `./work` | Output directory |
| `--targets <list>` | all 6 | Comma-separated, e.g. `win32-x64,linux-x64,linux-arm64` |
| `--only <ids>` | all bundleable | Only fetch these LSP ids |
| `--skip <ids>` | — | Skip these LSP ids |
| `--concurrency <n>` | `4` | Parallel downloads per target |

Environment: `GITHUB_TOKEN` or `GH_TOKEN` (optional) to avoid GitHub API rate-limits.

### `oalsp bundle`

Packs `work/<target>/` into one tar.gz per target. Run on the same machine as `fetch`.

| Flag | Default | Description |
|---|---|---|
| `--work <dir>` | `./work` | Input dir produced by `fetch` |
| `--out <dir>` | `./bundles` | Bundle output dir |
| `--targets <list>` | auto-detected | Limit which targets to bundle |

### `oalsp install`

Extracts a bundle on the air-gapped target and places each LSP at its final location.

| Flag | Default | Description |
|---|---|---|
| `--bundle <file>` | (required) | Path to `opencode-lsp-bundle-<target>-<date>.tar.gz` |
| `--prefix <dir>` | `~/.opencode-lsp` | Install prefix |
| `--only <ids>` | — | Only install these LSPs |
| `--skip <ids>` | — | Skip these LSPs |
| `--skip-verify` | off | Skip SHA-256 verification (not recommended) |

Writes `<prefix>/manifest.installed.json` recording which LSPs landed where.

### `oalsp config`

Generates `opencode.jsonc` with LSP commands pointing at the installed prefix.

| Flag | Default | Description |
|---|---|---|
| `--prefix <dir>` | `~/.opencode-lsp` | Install prefix to read from |
| `--out <file>` | `<prefix>/opencode.jsonc` | Output path |
| `--only-installed` | off | Disable toolchain-only LSPs that aren't bundled |
| `--merge <file>` | — | Merge into an existing `opencode.jsonc`, preserving non-LSP keys |

### `oalsp list`

Prints every supported LSP, grouped by source type. Pass `--verbose` for notes.

## Supported LSPs

**36 total** — mirrors opencode's [`server.ts`](https://github.com/anomalyco/opencode/blob/main/packages/opencode/src/lsp/server.ts), except for `ty` (experimental Python LSP, runtime toggle).

### Bundleable (27) — shipped fully offline

| Category | LSPs |
|---|---|
| **GitHub release binaries** | `clangd`, `rust`, `zls`, `lua-ls`, `texlab`, `tinymist`, `clojure-lsp`, `haskell-language-server`, `elixir-ls` |
| **npm packages** | `typescript`, `vue`, `svelte`, `astro`, `yaml-ls`, `pyright`, `php intelephense`, `bash`, `dockerfile`, `biome`\*, `oxlint`\* |
| **HashiCorp releases** | `terraform` |
| **JetBrains CDN** | `kotlin-ls` |
| **Eclipse Foundation** | `jdtls` |
| **GitHub source zip** | `eslint` |
| **.NET tools (NuGet)** | `csharp`, `fsharp` |
| **RubyGems** | `ruby-lsp` |

\* Downloads the main package plus the matching `optionalDependencies` native sub-package per target.

### Toolchain-only (9) — requires the language SDK on the target

`deno`, `gopls`, `dart`, `gleam`, `julials`, `prisma`, `nixd`, `sourcekit-lsp`, `ocaml-lsp`

These LSPs ship with their language toolchain (e.g. `deno lsp` is part of Deno itself). `oalsp config` still emits config entries for them assuming the toolchain binary is on PATH.

## Platform / architecture matrix

Targets: `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`.

Most LSPs cover all six. A few exceptions:

- `clangd` — upstream publishes only x64 prebuilts.
- `haskell-language-server` — no `linux-arm64` / `win32-arm64` upstream assets.
- `zls` — no `darwin-*-x86` (32-bit) assets; arm64 + x64 only.

`oalsp fetch` will skip missing-asset combinations and record them in `manifest.json` under `failed`.

## Target-machine requirements

You don't need the internet, but a few LSPs still lean on tools that must be pre-installed:

| LSP | Required on target |
|---|---|
| all Node-based (typescript, pyright, vue, …) | `node` on PATH |
| `gopls` | Go SDK (toolchain-only) |
| `ruby-lsp` | Ruby + `gem` (used to install the bundled `.gem` offline) |
| `csharp`, `fsharp` | .NET SDK (used to install bundled `.nupkg` offline) |
| `jdtls`, `kotlin-ls` | Java 21+ |
| `eslint` | `node` + `npm` (needs `npm install --omit=dev && npm run compile` once after install — see notes below) |
| `elixir-ls` | Erlang/Elixir matching the prebuilt's OTP version |
| toolchain-only LSPs | their respective language SDK |

## opencode integration

`oalsp config` emits something like:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "pyright": {
      "command": [
        "node",
        "/home/user/.opencode-lsp/pyright/package/langserver.index.js",
        "--stdio"
      ]
    },
    "clangd": {
      "command": [
        "/home/user/.opencode-lsp/clangd/clangd_19.1.2/bin/clangd",
        "--background-index",
        "--clang-tidy"
      ]
    },
    // …27 bundleable + 9 toolchain entries, plus `{ disabled: true }` for the rest
  }
}
```

Export `OPENCODE_DISABLE_LSP_DOWNLOAD=true` before launching opencode so it trusts the config instead of reaching for the network.

## Upstream sync

The registry in `src/registry.ts` is a hand-mirrored snapshot of opencode's `server.ts`. Three guardrails keep it honest:

- **`./UPSTREAM`** — records the exact opencode commit (`UPSTREAM_SHA`) the registry matches.
- **`bun run check-drift`** — parses upstream `server.ts` via the TypeScript compiler API, diffs id sets and literal `extensions` arrays against our registry, exits non-zero on drift.
- **CI** (`.github/workflows/`):
  - `verify.yml` — on push/PR, runs typecheck + drift check against the pinned commit.
  - `upstream-drift.yml` — weekly cron + manual dispatch, checks upstream HEAD and opens/updates a single tracking issue when drift appears (and auto-closes it when resolved).

### When upstream moves

```sh
# 1. Pull latest opencode (assuming it's a sibling checkout)
cd ../opencode && git pull && cd ../opencode-airgap-lsp

# 2. See what changed
bun run check-drift

# 3. Update src/registry.ts, then bump UPSTREAM_SHA in ./UPSTREAM

# 4. Confirm clean
bun run verify
```

What `check-drift` does **not** verify: command/args, initialization options, and the `root` function. These are built imperatively inside `server.ts` `spawn()` bodies and extracting them would break on benign refactors. They surface as runtime errors when opencode tries to spawn the LSP.

## Development

```sh
bun install
bun run typecheck            # tsc --noEmit
bun run check-drift          # requires a local opencode checkout
bun run verify               # typecheck + check-drift
bun run cli list             # sanity-check the registry
bun run cli fetch --only pyright --targets win32-x64   # smallest round-trip
```

Code layout:

```
src/
  cli.ts               command dispatch + arg parsing
  types.ts             Target, Source, LspEntry, FetchedArtifact, OpencodeLspConfig
  registry.ts          the 36 LSP entries + INTENTIONALLY_SKIPPED_UPSTREAM
  fetchers/
    util.ts            streaming download + sha256 + retry
    github.ts          github-release + github-zip
    npm.ts             npm + optionalNatives
    hashicorp.ts       terraform-ls
    jetbrains.ts       kotlin-ls
    eclipse.ts         jdtls
    dotnet.ts          NuGet v3 flat container
    rubygem.ts         RubyGems.org
    index.ts           dispatcher
  commands/
    fetch.ts           per-target download loop + manifest
    bundle.ts          tar.gz per target
    install.ts         verify + per-LSP extraction/placement
    config.ts          opencode.jsonc generator
scripts/
  check-drift.ts       TS compiler API AST diff against upstream server.ts
.github/workflows/
  verify.yml           push/PR: typecheck + drift vs pinned SHA
  upstream-drift.yml   cron: drift vs HEAD + issue management
UPSTREAM                pinned upstream commit + repo URL
```

## Known limitations

- **eslint needs a build step on the target.** vscode-eslint ships as TypeScript source, so after `oalsp install` the user must run `npm install --omit=dev && npm run compile` inside `<prefix>/eslint/`. If your target genuinely has no network, pre-populating `node_modules/` is future work.
- **elixir-ls OTP matching.** The prebuilt release is compiled against a specific Erlang/OTP version; the target's Elixir must match.
- **`clangd` / `haskell-language-server` on arm64.** Upstream has no prebuilts for some arm64 combos (see matrix above).
- **`ty` is not bundled.** Enable opencode's `OPENCODE_EXPERIMENTAL_LSP_TY` and install ty into your venv manually if you want it.
- **Symlinks + Windows.** The install step doesn't create symlinks — every LSP is referenced by its extracted binary path in the generated config.

## License

TBD.
