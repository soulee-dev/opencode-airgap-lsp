/**
 * Registry of all 37 LSP servers supported by opencode.
 *
 * Source of truth: opencode/packages/opencode/src/lsp/server.ts
 *
 * For each LSP we record:
 *   - `id`: must exactly match opencode's server.id (this is the key in opencode.jsonc "lsp")
 *   - `source`: how to download the raw artifact per target
 *   - `binPath`: relative path to the LSP binary after installation
 *   - `command`: opencode config command template (`{bin}` is substituted with the absolute bin path)
 *
 * Targets use keys like "win32-x64", "linux-arm64", etc. Use "*" to mean "applies to all targets".
 *
 * Convention: installed layout under <prefix>/ is:
 *   <prefix>/<id>/...           — binaries and support files
 *   <prefix>/bin/               — flat dir of launcher symlinks/scripts (optional)
 *
 * Bundleable categories:
 *   A) github-release binaries (clangd, zls, lua-ls, texlab, tinymist, rust-analyzer, clojure-lsp, hls)
 *   B) npm packages (typescript, vue, svelte, astro, yaml-ls, pyright, intelephense, bash, dockerfile, biome, oxlint)
 *   C) hashicorp (terraform-ls)
 *   D) jetbrains cdn (kotlin-ls)
 *   E) eclipse (jdtls) — platform-agnostic, but requires Java 21+ on target
 *   F) github-zip with post-build (eslint)
 *   G) github-release full archives (elixir-ls prebuilt, dotnet tools via nupkg)
 *   H) rubygems (rubocop)
 *   I) dotnet-tool (csharp-ls, fsautocomplete)
 *
 * Toolchain-only (no artifact bundled, just doc + config entry):
 *   deno, dart, gleam, julia, prisma, nixd, sourcekit-lsp, gopls, ocaml-lsp
 *
 * NOTE: `ty` (experimental Python LSP) is intentionally omitted — it's only enabled
 * when OPENCODE_EXPERIMENTAL_LSP_TY=true and replaces pyright at runtime.
 */

import type { LspEntry } from "./types.ts"

const NPM_VERSIONS: Record<string, string> = {
  // Pin known-good versions here if reproducibility matters. "latest" resolves at fetch time.
}

export const REGISTRY: LspEntry[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // A) GitHub-release native binaries
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "clangd",
    description: "C/C++/Objective-C language server (LLVM project)",
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "clangd/clangd",
        asset: "clangd-windows-{version}.zip",
        format: "zip",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "clangd/clangd",
        asset: "clangd-linux-{version}.zip",
        format: "zip",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "clangd/clangd",
        asset: "clangd-mac-{version}.zip",
        format: "zip",
      },
      // upstream does not ship win32-arm64, linux-arm64, darwin-arm64 prebuilts as of 2026-04.
    },
    binPath: {
      "win32-x64": "clangd/clangd_{version}/bin/clangd.exe",
      "linux-x64": "clangd/clangd_{version}/bin/clangd",
      "darwin-x64": "clangd/clangd_{version}/bin/clangd",
    },
    command: ["{bin}", "--background-index", "--clang-tidy"],
    notes: "Upstream publishes only x64 prebuilts. arm64 users must compile from source or use distro packages.",
  },

  {
    id: "rust",
    description: "rust-analyzer — official Rust LSP",
    extensions: [".rs"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "rust-lang/rust-analyzer",
        asset: "rust-analyzer-x86_64-pc-windows-msvc.zip",
        format: "zip",
      },
      "win32-arm64": {
        kind: "github-release",
        repo: "rust-lang/rust-analyzer",
        asset: "rust-analyzer-aarch64-pc-windows-msvc.zip",
        format: "zip",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "rust-lang/rust-analyzer",
        asset: "rust-analyzer-x86_64-unknown-linux-gnu.gz",
        format: "none", // actually gzipped single binary — handled specially by extractor
      },
      "linux-arm64": {
        kind: "github-release",
        repo: "rust-lang/rust-analyzer",
        asset: "rust-analyzer-aarch64-unknown-linux-gnu.gz",
        format: "none",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "rust-lang/rust-analyzer",
        asset: "rust-analyzer-x86_64-apple-darwin.gz",
        format: "none",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "rust-lang/rust-analyzer",
        asset: "rust-analyzer-aarch64-apple-darwin.gz",
        format: "none",
      },
    },
    binPath: {
      "win32-x64": "rust/rust-analyzer.exe",
      "win32-arm64": "rust/rust-analyzer.exe",
      "linux-x64": "rust/rust-analyzer",
      "linux-arm64": "rust/rust-analyzer",
      "darwin-x64": "rust/rust-analyzer",
      "darwin-arm64": "rust/rust-analyzer",
    },
    command: ["{bin}"],
    notes: "Linux/macOS releases ship a single gzipped binary, not a tarball.",
  },

  {
    id: "zls",
    description: "Zig language server",
    extensions: [".zig", ".zon"],
    source: {
      "win32-x64": { kind: "github-release", repo: "zigtools/zls", asset: "zls-x86_64-windows.zip", format: "zip" },
      "win32-arm64": { kind: "github-release", repo: "zigtools/zls", asset: "zls-aarch64-windows.zip", format: "zip" },
      "linux-x64": { kind: "github-release", repo: "zigtools/zls", asset: "zls-x86_64-linux.tar.xz", format: "tar.xz" },
      "linux-arm64": {
        kind: "github-release",
        repo: "zigtools/zls",
        asset: "zls-aarch64-linux.tar.xz",
        format: "tar.xz",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "zigtools/zls",
        asset: "zls-x86_64-macos.tar.xz",
        format: "tar.xz",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "zigtools/zls",
        asset: "zls-aarch64-macos.tar.xz",
        format: "tar.xz",
      },
    },
    binPath: {
      "win32-x64": "zls/zls.exe",
      "win32-arm64": "zls/zls.exe",
      "linux-x64": "zls/zls",
      "linux-arm64": "zls/zls",
      "darwin-x64": "zls/zls",
      "darwin-arm64": "zls/zls",
    },
    command: ["{bin}"],
  },

  {
    id: "lua-ls",
    description: "lua-language-server (sumneko)",
    extensions: [".lua"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "LuaLS/lua-language-server",
        asset: "lua-language-server-{version}-win32-x64.zip",
        format: "zip",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "LuaLS/lua-language-server",
        asset: "lua-language-server-{version}-linux-x64.tar.gz",
        format: "tar.gz",
      },
      "linux-arm64": {
        kind: "github-release",
        repo: "LuaLS/lua-language-server",
        asset: "lua-language-server-{version}-linux-arm64.tar.gz",
        format: "tar.gz",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "LuaLS/lua-language-server",
        asset: "lua-language-server-{version}-darwin-x64.tar.gz",
        format: "tar.gz",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "LuaLS/lua-language-server",
        asset: "lua-language-server-{version}-darwin-arm64.tar.gz",
        format: "tar.gz",
      },
    },
    binPath: {
      "win32-x64": "lua-ls/bin/lua-language-server.exe",
      "linux-x64": "lua-ls/bin/lua-language-server",
      "linux-arm64": "lua-ls/bin/lua-language-server",
      "darwin-x64": "lua-ls/bin/lua-language-server",
      "darwin-arm64": "lua-ls/bin/lua-language-server",
    },
    command: ["{bin}"],
    notes: "Archive extracts to the install dir directly (no top-level version folder). Needs meta/ and locale/ siblings.",
  },

  {
    id: "texlab",
    description: "LaTeX language server",
    extensions: [".tex", ".bib"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "latex-lsp/texlab",
        asset: "texlab-x86_64-windows.zip",
        format: "zip",
      },
      "win32-arm64": {
        kind: "github-release",
        repo: "latex-lsp/texlab",
        asset: "texlab-aarch64-windows.zip",
        format: "zip",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "latex-lsp/texlab",
        asset: "texlab-x86_64-linux.tar.gz",
        format: "tar.gz",
      },
      "linux-arm64": {
        kind: "github-release",
        repo: "latex-lsp/texlab",
        asset: "texlab-aarch64-linux.tar.gz",
        format: "tar.gz",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "latex-lsp/texlab",
        asset: "texlab-x86_64-macos.tar.gz",
        format: "tar.gz",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "latex-lsp/texlab",
        asset: "texlab-aarch64-macos.tar.gz",
        format: "tar.gz",
      },
    },
    binPath: {
      "win32-x64": "texlab/texlab.exe",
      "win32-arm64": "texlab/texlab.exe",
      "linux-x64": "texlab/texlab",
      "linux-arm64": "texlab/texlab",
      "darwin-x64": "texlab/texlab",
      "darwin-arm64": "texlab/texlab",
    },
    command: ["{bin}"],
  },

  {
    id: "tinymist",
    description: "Typst language server",
    extensions: [".typ", ".typc"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "Myriad-Dreamin/tinymist",
        asset: "tinymist-x86_64-pc-windows-msvc.zip",
        format: "zip",
      },
      "win32-arm64": {
        kind: "github-release",
        repo: "Myriad-Dreamin/tinymist",
        asset: "tinymist-aarch64-pc-windows-msvc.zip",
        format: "zip",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "Myriad-Dreamin/tinymist",
        asset: "tinymist-x86_64-unknown-linux-gnu.tar.gz",
        format: "tar.gz",
      },
      "linux-arm64": {
        kind: "github-release",
        repo: "Myriad-Dreamin/tinymist",
        asset: "tinymist-aarch64-unknown-linux-gnu.tar.gz",
        format: "tar.gz",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "Myriad-Dreamin/tinymist",
        asset: "tinymist-x86_64-apple-darwin.tar.gz",
        format: "tar.gz",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "Myriad-Dreamin/tinymist",
        asset: "tinymist-aarch64-apple-darwin.tar.gz",
        format: "tar.gz",
      },
    },
    binPath: {
      "win32-x64": "tinymist/tinymist.exe",
      "win32-arm64": "tinymist/tinymist.exe",
      "linux-x64": "tinymist/tinymist",
      "linux-arm64": "tinymist/tinymist",
      "darwin-x64": "tinymist/tinymist",
      "darwin-arm64": "tinymist/tinymist",
    },
    command: ["{bin}"],
  },

  {
    id: "clojure-lsp",
    description: "Clojure language server (native image)",
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "clojure-lsp/clojure-lsp",
        asset: "clojure-lsp-native-windows-amd64.zip",
        format: "zip",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "clojure-lsp/clojure-lsp",
        asset: "clojure-lsp-native-linux-amd64.zip",
        format: "zip",
      },
      "linux-arm64": {
        kind: "github-release",
        repo: "clojure-lsp/clojure-lsp",
        asset: "clojure-lsp-native-linux-aarch64.zip",
        format: "zip",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "clojure-lsp/clojure-lsp",
        asset: "clojure-lsp-native-macos-amd64.zip",
        format: "zip",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "clojure-lsp/clojure-lsp",
        asset: "clojure-lsp-native-macos-aarch64.zip",
        format: "zip",
      },
    },
    binPath: {
      "win32-x64": "clojure-lsp/clojure-lsp.exe",
      "linux-x64": "clojure-lsp/clojure-lsp",
      "linux-arm64": "clojure-lsp/clojure-lsp",
      "darwin-x64": "clojure-lsp/clojure-lsp",
      "darwin-arm64": "clojure-lsp/clojure-lsp",
    },
    command: ["{bin}", "listen"],
  },

  {
    id: "haskell-language-server",
    description: "Haskell Language Server (wrapper)",
    extensions: [".hs", ".lhs"],
    source: {
      "win32-x64": {
        kind: "github-release",
        repo: "haskell/haskell-language-server",
        asset: "haskell-language-server-{version}-x86_64-windows.tar.xz",
        format: "tar.xz",
      },
      "linux-x64": {
        kind: "github-release",
        repo: "haskell/haskell-language-server",
        asset: "haskell-language-server-{version}-x86_64-linux-unknown.tar.xz",
        format: "tar.xz",
      },
      "darwin-x64": {
        kind: "github-release",
        repo: "haskell/haskell-language-server",
        asset: "haskell-language-server-{version}-x86_64-apple-darwin.tar.xz",
        format: "tar.xz",
      },
      "darwin-arm64": {
        kind: "github-release",
        repo: "haskell/haskell-language-server",
        asset: "haskell-language-server-{version}-aarch64-apple-darwin.tar.xz",
        format: "tar.xz",
      },
    },
    binPath: {
      "win32-x64": "haskell-language-server/haskell-language-server-wrapper.exe",
      "linux-x64": "haskell-language-server/haskell-language-server-wrapper",
      "darwin-x64": "haskell-language-server/haskell-language-server-wrapper",
      "darwin-arm64": "haskell-language-server/haskell-language-server-wrapper",
    },
    command: ["{bin}", "--lsp"],
    notes: "HLS also requires a matching GHC on PATH. The wrapper delegates to ghcup.",
  },

  {
    id: "elixir-ls",
    description: "Elixir Language Server (prebuilt release)",
    extensions: [".ex", ".exs"],
    source: {
      "*": {
        kind: "github-release",
        repo: "elixir-lsp/elixir-ls",
        // Prebuilt release is OTP/Elixir version specific. Users will need to pick appropriate asset
        // matching their Erlang/OTP install. We fetch the "main" OTP-26 flavor as default.
        asset: "elixir-ls-v{version}.zip",
        format: "zip",
      },
    },
    binPath: {
      "win32-x64": "elixir-ls/language_server.bat",
      "win32-arm64": "elixir-ls/language_server.bat",
      "linux-x64": "elixir-ls/language_server.sh",
      "linux-arm64": "elixir-ls/language_server.sh",
      "darwin-x64": "elixir-ls/language_server.sh",
      "darwin-arm64": "elixir-ls/language_server.sh",
    },
    command: ["{bin}"],
    notes: "Requires Elixir + matching OTP on target. Recent releases ship prebuilt zip without Mix build step.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // B) NPM packages (platform-agnostic JavaScript — plus native-dep variants)
  // ──────────────────────────────────────────────────────────────────────────
  //
  // For npm LSPs we download the tarball (.tgz). On install we unpack into
  // <prefix>/<id>/ so the CLI is at <prefix>/<id>/package/...
  // All Node-based LSPs are invoked as `node <path-to-cli.js> --stdio`.

  {
    id: "typescript",
    description: "typescript-language-server",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    source: {
      "*": { kind: "npm", pkg: "typescript-language-server", version: NPM_VERSIONS["typescript-language-server"] },
    },
    binPath: {
      "*": "typescript/package/lib/cli.mjs",
    },
    command: ["node", "{bin}", "--stdio"],
    notes: "Also requires workspace-local `typescript` npm package (tsserver.js) at runtime — opencode resolves it from Instance.directory.",
  },

  {
    id: "vue",
    description: "@vue/language-server",
    extensions: [".vue"],
    source: {
      "*": { kind: "npm", pkg: "@vue/language-server" },
    },
    binPath: {
      "*": "vue/package/bin/vue-language-server.js",
    },
    command: ["node", "{bin}", "--stdio"],
  },

  {
    id: "svelte",
    description: "svelte-language-server",
    extensions: [".svelte"],
    source: {
      "*": { kind: "npm", pkg: "svelte-language-server" },
    },
    binPath: {
      "*": "svelte/package/bin/server.js",
    },
    command: ["node", "{bin}", "--stdio"],
  },

  {
    id: "astro",
    description: "@astrojs/language-server",
    extensions: [".astro"],
    source: {
      "*": { kind: "npm", pkg: "@astrojs/language-server" },
    },
    binPath: {
      "*": "astro/package/bin/nodeServer.js",
    },
    command: ["node", "{bin}", "--stdio"],
    notes: "Also needs workspace-local `typescript` at runtime (opencode passes tsdk via initialization).",
  },

  {
    id: "yaml-ls",
    description: "yaml-language-server",
    extensions: [".yaml", ".yml"],
    source: {
      "*": { kind: "npm", pkg: "yaml-language-server" },
    },
    binPath: {
      "*": "yaml-ls/package/bin/yaml-language-server",
    },
    command: ["node", "{bin}", "--stdio"],
  },

  {
    id: "pyright",
    description: "Pyright — Python static type checker + LSP",
    extensions: [".py", ".pyi"],
    source: {
      "*": { kind: "npm", pkg: "pyright" },
    },
    binPath: {
      "*": "pyright/package/langserver.index.js",
    },
    command: ["node", "{bin}", "--stdio"],
    notes: "Opencode auto-detects .venv / venv / $VIRTUAL_ENV and injects pythonPath via initialization.",
  },

  {
    id: "php intelephense",
    description: "Intelephense — PHP language server",
    extensions: [".php"],
    source: {
      "*": { kind: "npm", pkg: "intelephense" },
    },
    binPath: {
      "*": "php-intelephense/package/lib/intelephense.js",
    },
    command: ["node", "{bin}", "--stdio"],
    initialization: { telemetry: { enabled: false } },
    notes: "LSP id contains a space — must be quoted as-is in opencode.jsonc. Free tier; premium features need a license.",
  },

  {
    id: "bash",
    description: "bash-language-server",
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    source: {
      "*": { kind: "npm", pkg: "bash-language-server" },
    },
    binPath: {
      "*": "bash/package/out/cli.js",
    },
    command: ["node", "{bin}", "start"],
  },

  {
    id: "dockerfile",
    description: "dockerfile-language-server-nodejs",
    extensions: [".dockerfile", "Dockerfile"],
    source: {
      "*": { kind: "npm", pkg: "dockerfile-language-server-nodejs" },
    },
    binPath: {
      "*": "dockerfile/package/lib/server.js",
    },
    command: ["node", "{bin}", "--stdio"],
  },

  {
    id: "biome",
    description: "Biome — JS/TS formatter+linter LSP",
    extensions: [
      ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
      ".json", ".jsonc", ".vue", ".astro", ".svelte", ".css", ".graphql", ".gql", ".html",
    ],
    source: {
      "win32-x64": {
        kind: "npm",
        pkg: "@biomejs/biome",
        optionalNatives: {
          nameTemplate: "@biomejs/cli-{platform}-{arch}",
          platformMap: { win32: "win32" },
          archMap: { x64: "x64" },
        },
      },
      "win32-arm64": {
        kind: "npm",
        pkg: "@biomejs/biome",
        optionalNatives: { nameTemplate: "@biomejs/cli-{platform}-{arch}" },
      },
      "linux-x64": {
        kind: "npm",
        pkg: "@biomejs/biome",
        optionalNatives: { nameTemplate: "@biomejs/cli-{platform}-{arch}" },
      },
      "linux-arm64": {
        kind: "npm",
        pkg: "@biomejs/biome",
        optionalNatives: { nameTemplate: "@biomejs/cli-{platform}-{arch}" },
      },
      "darwin-x64": {
        kind: "npm",
        pkg: "@biomejs/biome",
        optionalNatives: { nameTemplate: "@biomejs/cli-{platform}-{arch}" },
      },
      "darwin-arm64": {
        kind: "npm",
        pkg: "@biomejs/biome",
        optionalNatives: { nameTemplate: "@biomejs/cli-{platform}-{arch}" },
      },
    },
    binPath: {
      "win32-x64": "biome/package/node_modules/@biomejs/cli-win32-x64/biome.exe",
      "win32-arm64": "biome/package/node_modules/@biomejs/cli-win32-arm64/biome.exe",
      "linux-x64": "biome/package/node_modules/@biomejs/cli-linux-x64/biome",
      "linux-arm64": "biome/package/node_modules/@biomejs/cli-linux-arm64/biome",
      "darwin-x64": "biome/package/node_modules/@biomejs/cli-darwin-x64/biome",
      "darwin-arm64": "biome/package/node_modules/@biomejs/cli-darwin-arm64/biome",
    },
    command: ["{bin}", "lsp-proxy", "--stdio"],
    notes: "Biome ships a platform-specific native binary via optionalDependencies. The installer places each native pkg under node_modules/@biomejs/.",
  },

  {
    id: "oxlint",
    description: "Oxlint — fast JS/TS linter LSP",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
    source: {
      "win32-x64": {
        kind: "npm",
        pkg: "oxlint",
        optionalNatives: { nameTemplate: "@oxlint/{platform}-{arch}" },
      },
      "win32-arm64": {
        kind: "npm",
        pkg: "oxlint",
        optionalNatives: { nameTemplate: "@oxlint/{platform}-{arch}" },
      },
      "linux-x64": {
        kind: "npm",
        pkg: "oxlint",
        optionalNatives: { nameTemplate: "@oxlint/{platform}-{arch}" },
      },
      "linux-arm64": {
        kind: "npm",
        pkg: "oxlint",
        optionalNatives: { nameTemplate: "@oxlint/{platform}-{arch}" },
      },
      "darwin-x64": {
        kind: "npm",
        pkg: "oxlint",
        optionalNatives: { nameTemplate: "@oxlint/{platform}-{arch}" },
      },
      "darwin-arm64": {
        kind: "npm",
        pkg: "oxlint",
        optionalNatives: { nameTemplate: "@oxlint/{platform}-{arch}" },
      },
    },
    binPath: {
      "win32-x64": "oxlint/package/node_modules/@oxlint/win32-x64/oxlint.exe",
      "win32-arm64": "oxlint/package/node_modules/@oxlint/win32-arm64/oxlint.exe",
      "linux-x64": "oxlint/package/node_modules/@oxlint/linux-x64/oxlint",
      "linux-arm64": "oxlint/package/node_modules/@oxlint/linux-arm64/oxlint",
      "darwin-x64": "oxlint/package/node_modules/@oxlint/darwin-x64/oxlint",
      "darwin-arm64": "oxlint/package/node_modules/@oxlint/darwin-arm64/oxlint",
    },
    command: ["{bin}", "--lsp"],
    notes: "oxlint uses `--lsp` flag (server.ts prefers the oxlint CLI over oxc_language_server).",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // C) HashiCorp releases
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "terraform",
    description: "terraform-ls — HashiCorp's Terraform LSP",
    extensions: [".tf", ".tfvars"],
    source: {
      "win32-x64": { kind: "hashicorp", product: "terraform-ls" },
      "win32-arm64": { kind: "hashicorp", product: "terraform-ls" },
      "linux-x64": { kind: "hashicorp", product: "terraform-ls" },
      "linux-arm64": { kind: "hashicorp", product: "terraform-ls" },
      "darwin-x64": { kind: "hashicorp", product: "terraform-ls" },
      "darwin-arm64": { kind: "hashicorp", product: "terraform-ls" },
    },
    binPath: {
      "win32-x64": "terraform/terraform-ls.exe",
      "win32-arm64": "terraform/terraform-ls.exe",
      "linux-x64": "terraform/terraform-ls",
      "linux-arm64": "terraform/terraform-ls",
      "darwin-x64": "terraform/terraform-ls",
      "darwin-arm64": "terraform/terraform-ls",
    },
    command: ["{bin}", "serve"],
    initialization: {
      experimentalFeatures: { prefillRequiredFields: true, validateOnSave: true },
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // D) JetBrains CDN
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "kotlin-ls",
    description: "Kotlin LSP (JetBrains)",
    extensions: [".kt", ".kts"],
    source: {
      "win32-x64": { kind: "jetbrains-kotlin-lsp", versionRepo: "Kotlin/kotlin-lsp" },
      "win32-arm64": { kind: "jetbrains-kotlin-lsp", versionRepo: "Kotlin/kotlin-lsp" },
      "linux-x64": { kind: "jetbrains-kotlin-lsp", versionRepo: "Kotlin/kotlin-lsp" },
      "linux-arm64": { kind: "jetbrains-kotlin-lsp", versionRepo: "Kotlin/kotlin-lsp" },
      "darwin-x64": { kind: "jetbrains-kotlin-lsp", versionRepo: "Kotlin/kotlin-lsp" },
      "darwin-arm64": { kind: "jetbrains-kotlin-lsp", versionRepo: "Kotlin/kotlin-lsp" },
    },
    binPath: {
      "win32-x64": "kotlin-ls/kotlin-lsp.cmd",
      "win32-arm64": "kotlin-ls/kotlin-lsp.cmd",
      "linux-x64": "kotlin-ls/kotlin-lsp.sh",
      "linux-arm64": "kotlin-ls/kotlin-lsp.sh",
      "darwin-x64": "kotlin-ls/kotlin-lsp.sh",
      "darwin-arm64": "kotlin-ls/kotlin-lsp.sh",
    },
    command: ["{bin}", "--stdio"],
    notes: "Requires a JDK on PATH (see JetBrains docs). Version resolved from github.com/Kotlin/kotlin-lsp releases; asset is pulled from download-cdn.jetbrains.com.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // E) Eclipse Foundation (JDTLS)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "jdtls",
    description: "Eclipse JDT language server (Java)",
    extensions: [".java"],
    source: {
      "*": {
        kind: "eclipse-jdtls",
        url: "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz",
      },
    },
    binPath: {
      "*": "jdtls/",
    },
    // Command is synthesized specially by the config generator because it needs
    // the launcher jar name (which varies per snapshot) plus platform-specific
    // config dir. The generator will expand {bin} to the jdtls dir and emit the
    // full java -jar ... command. See src/commands/config.ts.
    command: ["__JDTLS__"],
    notes: "Requires Java 21+ on target. Installer writes a jdtls-launcher.{sh,cmd} wrapper script so the command stays stable across snapshots.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // F) GitHub source zip with post-extract build (ESLint)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "eslint",
    description: "VS Code ESLint language server",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    source: {
      "*": {
        kind: "github-zip",
        repo: "microsoft/vscode-eslint",
        ref: "main",
        postExtract: [
          ["npm", "install", "--omit=dev"],
          ["npm", "run", "compile"],
        ],
      },
    },
    binPath: {
      "*": "eslint/server/out/eslintServer.js",
    },
    command: ["node", "{bin}", "--stdio"],
    notes: "Requires node+npm on target at install time for the compile step. Also requires workspace-local `eslint` at runtime.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // G) .NET tools (nupkg from nuget.org)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "csharp",
    description: "csharp-ls — F# community C# language server",
    extensions: [".cs"],
    source: {
      "*": { kind: "dotnet-tool", pkg: "csharp-ls" },
    },
    binPath: {
      "win32-x64": "csharp/csharp-ls.exe",
      "win32-arm64": "csharp/csharp-ls.exe",
      "linux-x64": "csharp/csharp-ls",
      "linux-arm64": "csharp/csharp-ls",
      "darwin-x64": "csharp/csharp-ls",
      "darwin-arm64": "csharp/csharp-ls",
    },
    command: ["{bin}"],
    notes: "Requires .NET SDK on target. Installer runs `dotnet tool install` against a local nupkg source.",
  },

  {
    id: "fsharp",
    description: "FsAutoComplete — F# language server",
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
    source: {
      "*": { kind: "dotnet-tool", pkg: "fsautocomplete" },
    },
    binPath: {
      "win32-x64": "fsharp/fsautocomplete.exe",
      "win32-arm64": "fsharp/fsautocomplete.exe",
      "linux-x64": "fsharp/fsautocomplete",
      "linux-arm64": "fsharp/fsautocomplete",
      "darwin-x64": "fsharp/fsautocomplete",
      "darwin-arm64": "fsharp/fsautocomplete",
    },
    command: ["{bin}"],
    notes: "Requires .NET SDK on target.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // H) RubyGems
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "ruby-lsp",
    description: "Rubocop LSP (opencode's default Ruby backend)",
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    source: {
      "*": { kind: "rubygem", gem: "rubocop" },
    },
    binPath: {
      "win32-x64": "ruby-lsp/bin/rubocop.bat",
      "win32-arm64": "ruby-lsp/bin/rubocop.bat",
      "linux-x64": "ruby-lsp/bin/rubocop",
      "linux-arm64": "ruby-lsp/bin/rubocop",
      "darwin-x64": "ruby-lsp/bin/rubocop",
      "darwin-arm64": "ruby-lsp/bin/rubocop",
    },
    command: ["{bin}", "--lsp"],
    notes: "Requires Ruby on target. Installer runs `gem install --local rubocop-X.gem --bindir <prefix>/ruby-lsp/bin`.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // I) Toolchain-only (no bundling — language toolchain ships the LSP)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "deno",
    description: "Deno (built-in LSP: `deno lsp`)",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "Install Deno: https://deno.land/manual/getting_started/installation" } },
    binPath: { "*": "deno" /* resolved on PATH */ },
    command: ["deno", "lsp"],
  },

  {
    id: "gopls",
    description: "Go language server",
    extensions: [".go"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "Install Go, then: go install golang.org/x/tools/gopls@latest (preload GOPATH tarball for airgap)" } },
    binPath: { "*": "gopls" },
    command: ["gopls"],
    notes: "Gopls requires Go toolchain. For airgap, build on connected machine with GOPROXY=off GOFLAGS=-mod=vendor and ship binary.",
  },

  {
    id: "dart",
    description: "Dart language server (built-in)",
    extensions: [".dart"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "Install Dart SDK: https://dart.dev/get-dart" } },
    binPath: { "*": "dart" },
    command: ["dart", "language-server", "--lsp"],
  },

  {
    id: "gleam",
    description: "Gleam language server (built-in)",
    extensions: [".gleam"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "Install Gleam compiler: https://gleam.run/getting-started/installing/" } },
    binPath: { "*": "gleam" },
    command: ["gleam", "lsp"],
  },

  {
    id: "julials",
    description: "Julia LanguageServer.jl",
    extensions: [".jl"],
    toolchainOnly: true,
    source: {
      "*": {
        kind: "toolchain",
        install: "Install Julia, then in REPL: using Pkg; Pkg.add(\"LanguageServer\")",
      },
    },
    binPath: { "*": "julia" },
    command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
  },

  {
    id: "prisma",
    description: "Prisma language server (via prisma CLI)",
    extensions: [".prisma"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "npm install -g prisma (or use workspace-local)" } },
    binPath: { "*": "prisma" },
    command: ["prisma", "language-server"],
  },

  {
    id: "nixd",
    description: "Nix language server",
    extensions: [".nix"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "nix profile install nixpkgs#nixd" } },
    binPath: { "*": "nixd" },
    command: ["nixd"],
  },

  {
    id: "sourcekit-lsp",
    description: "SourceKit-LSP (Swift toolchain)",
    extensions: [".swift", ".objc", "objcpp"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "Install Swift toolchain (includes sourcekit-lsp). On macOS: Xcode." } },
    binPath: { "*": "sourcekit-lsp" },
    command: ["sourcekit-lsp"],
  },

  {
    id: "ocaml-lsp",
    description: "OCaml language server",
    extensions: [".ml", ".mli"],
    toolchainOnly: true,
    source: { "*": { kind: "toolchain", install: "opam install ocaml-lsp-server" } },
    binPath: { "*": "ocamllsp" },
    command: ["ocamllsp"],
  },
]

// Sanity check: id uniqueness & count.
{
  const ids = new Set<string>()
  for (const e of REGISTRY) {
    if (ids.has(e.id)) throw new Error(`Duplicate LSP id: ${e.id}`)
    ids.add(e.id)
  }
  // 27 bundleable + 9 toolchain-only = 36. Opencode has 37 including `ty`,
  // but `ty` is experimental (enabled via OPENCODE_EXPERIMENTAL_LSP_TY) and
  // replaces pyright at runtime, so we don't ship a separate entry for it.
  if (REGISTRY.length !== 36) {
    // Non-fatal: log at import for visibility.
    // eslint-disable-next-line no-console
    console.warn(`[registry] expected 36 LSPs, found ${REGISTRY.length}`)
  }
}

/**
 * LSP ids defined in opencode's server.ts that we intentionally do NOT mirror.
 *
 * Used by `scripts/check-drift.ts` to suppress false-positive "missing upstream" errors.
 *
 * When adding an entry here, leave a comment explaining WHY — future maintainers need
 * to know whether the exclusion still applies after upstream changes.
 */
export const INTENTIONALLY_SKIPPED_UPSTREAM: ReadonlyArray<{ id: string; reason: string }> = [
  {
    id: "ty",
    reason:
      "Experimental Python LSP, enabled only when OPENCODE_EXPERIMENTAL_LSP_TY=true. " +
      "At runtime it replaces pyright (see opencode lsp.ts:118-128 filterExperimentalServers). " +
      "Users who want ty can install it manually into their venv.",
  },
]

export function entryById(id: string): LspEntry | undefined {
  return REGISTRY.find((e) => e.id === id)
}

export function bundleableEntries(): LspEntry[] {
  return REGISTRY.filter((e) => !e.toolchainOnly)
}

export function toolchainEntries(): LspEntry[] {
  return REGISTRY.filter((e) => e.toolchainOnly)
}
