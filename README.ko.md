# opencode-airgap-lsp

> 🇺🇸 English version: [README.md](./README.md)

망분리(에어갭) 환경에서 [opencode](https://github.com/anomalyco/opencode)를 제대로 쓰기 위한 오프라인 LSP 번들러 & 설치기입니다.

## 왜 만들었나

OpenCode라는 Agent AI 툴을 많이들 쓰지만, 제대로 쓰려면 LSP와 연동해야 합니다. LSP 없이는 에이전트가 타입·레퍼런스·진단 정보 없이 감으로 코드를 만지는 셈이라 품질이 크게 떨어집니다.

문제는 금융권처럼 높은 보안을 요구하는 곳의 내부망(망분리 환경)에서는 opencode가 "처음 쓸 때 LSP를 인터넷에서 받아오는" 기본 동작 자체가 막힌다는 점입니다. 손으로 하나하나 설치·설정하는 것도 만만치 않고요.

`opencode-airgap-lsp` (`oalsp`)는 이 일회성 설정을 **명령 두 개**로 끝낼 수 있게 해줍니다.

## 문제

opencode는 Language Server 바이너리를 처음 필요할 때 GitHub Releases, npm, NuGet, RubyGems, HashiCorp, Eclipse, JetBrains CDN 등에서 자동으로 내려받습니다. 망분리 네트워크에서는 이 호출이 전부 실패해서, 결국 언어 인텔리전스가 없는 반쪽짜리 에디터가 됩니다.

`OPENCODE_DISABLE_LSP_DOWNLOAD=true`를 설정해서 자동 다운로드를 끄고, `opencode.jsonc`로 사전 설치된 바이너리를 직접 가리키도록 할 수는 있습니다. 하지만 6개 플랫폼/아키텍처 × 36개 LSP를 손으로 맞추는 건 지루하고 실수도 잦습니다.

`opencode-airgap-lsp` (`oalsp`)가 이 일을 대신 해줍니다.

## 동작 방식

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [A] 인터넷 연결 가능한 머신
─────────────────────────────────────────────────────────────────────────

    $ oalsp fetch
        ↓  타겟별 원본 아티팩트 다운로드
    work/<platform>-<arch>/
      ├─ raw/            ← .tgz / .zip / .nupkg / .gem / .tar.xz / …
      └─ manifest.json   ← 모든 아티팩트의 버전 + SHA-256

    $ oalsp bundle
        ↓  타겟별로 tar.gz 하나씩
    bundles/
      └─ opencode-lsp-bundle-<platform>-<arch>-<date>.tar.gz

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              번들 전달 (USB, 내부 미러 등)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [B] 망분리 머신
─────────────────────────────────────────────────────────────────────────

    $ oalsp install --bundle <file>.tar.gz
        ↓  SHA-256 검증 + 각 LSP 추출
    <prefix>/
      ├─ <id>/...                  ← LSP 27개, 각자 자기 서브디렉터리에
      └─ manifest.installed.json

    $ oalsp config
        ↓  opencode.jsonc 생성
    ~/.config/opencode/opencode.jsonc
      → 36개 LSP 엔트리가 <prefix>/<id>/... 를 가리킴

    $ export OPENCODE_DISABLE_LSP_DOWNLOAD=true
    $ opencode     (네트워크 호출 없음)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **인터넷 쪽**에서 `fetch` + `bundle`을 실행합니다. 여기서는 압축 해제를 하지 않기 때문에 인터넷 머신의 OS가 타겟과 일치할 필요가 없습니다. 타겟당 보통 수백 MB 정도입니다.
- **망분리 쪽**에서 `install` + `config`를 실행합니다. 이 쪽에서는 어떤 네트워크 호출도 일어나지 않습니다.

## 빠른 시작

```sh
# 1. 인터넷 연결된 머신에서
git clone https://github.com/soulee-dev/opencode-airgap-lsp
cd opencode-airgap-lsp
bun install

# 지원하는 모든 타겟에 대해 전부 받기 (합쳐서 수 GB)
bun run cli fetch

# 타겟별 tarball로 ./bundles/ 아래에 패킹
bun run cli bundle

# 2. 번들을 망분리 머신으로 옮깁니다.
#    예) Windows x64: opencode-lsp-bundle-win32-x64-<date>.tar.gz

# 3. 망분리 머신에서 (같은 저장소 체크아웃 + bun, 오프라인이어도 됨)
bun run cli install --bundle ./opencode-lsp-bundle-win32-x64-<date>.tar.gz

# 4. 설치된 LSP를 가리키는 opencode.jsonc 생성
bun run cli config --out ~/.config/opencode/opencode.jsonc

# 5. opencode가 자동 다운로드를 시도하지 않도록
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
```

번들에 포함될 대상을 좁히고 싶다면 — 예: TypeScript + Python 도구만:

```sh
bun run cli fetch --targets win32-x64 --only typescript,pyright,vue
```

## 명령어

### `oalsp fetch`

하나 이상의 타겟에 대해 원본 LSP 아티팩트를 다운로드합니다. 인터넷 연결된 머신에서 실행합니다.

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--out <dir>` | `./work` | 출력 디렉터리 |
| `--targets <list>` | 6개 전부 | 콤마 구분, 예: `win32-x64,linux-x64,linux-arm64` |
| `--only <ids>` | 번들 가능한 전부 | 이 LSP id만 받기 |
| `--skip <ids>` | — | 이 LSP id는 건너뛰기 |
| `--concurrency <n>` | `4` | 타겟당 병렬 다운로드 수 |

환경변수: `GITHUB_TOKEN` 또는 `GH_TOKEN` (선택) — GitHub API 속도 제한을 피하고 싶다면.

### `oalsp bundle`

`work/<target>/` 을 타겟별 tar.gz 하나로 패킹합니다. `fetch`와 같은 머신에서 실행합니다.

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--work <dir>` | `./work` | `fetch`가 만든 입력 디렉터리 |
| `--out <dir>` | `./bundles` | 번들 출력 디렉터리 |
| `--targets <list>` | 자동 감지 | 번들할 타겟 제한 |

### `oalsp install`

망분리 타겟에서 번들을 풀어 각 LSP를 최종 위치에 배치합니다.

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--bundle <file>` | (필수) | `opencode-lsp-bundle-<target>-<date>.tar.gz` 경로 |
| `--prefix <dir>` | `~/.opencode-lsp` | 설치 prefix |
| `--only <ids>` | — | 이 LSP만 설치 |
| `--skip <ids>` | — | 이 LSP는 건너뛰기 |
| `--skip-verify` | off | SHA-256 검증 건너뛰기 (권장하지 않음) |

어느 LSP가 어디에 설치됐는지 `<prefix>/manifest.installed.json`에 기록합니다.

### `oalsp config`

설치 prefix를 가리키는 LSP 명령을 담은 `opencode.jsonc`를 생성합니다.

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--prefix <dir>` | `~/.opencode-lsp` | 읽어올 설치 prefix |
| `--out <file>` | `<prefix>/opencode.jsonc` | 출력 경로 |
| `--only-installed` | off | 번들되지 않은 toolchain 전용 LSP는 비활성화 |
| `--merge <file>` | — | 기존 `opencode.jsonc`에 병합, LSP 외 키는 보존 |

### `oalsp list`

지원하는 모든 LSP를 소스 타입별로 그룹화해서 출력합니다. `--verbose`로 상세 노트까지.

## 지원 LSP

**총 36개** — opencode의 [`server.ts`](https://github.com/anomalyco/opencode/blob/main/packages/opencode/src/lsp/server.ts)를 그대로 따라가며, `ty`(실험적 Python LSP, 런타임 토글)만 제외합니다.

### 번들 가능 (27) — 완전 오프라인으로 배포

| 분류 | LSPs |
|---|---|
| **GitHub release 바이너리** | `clangd`, `rust`, `zls`, `lua-ls`, `texlab`, `tinymist`, `clojure-lsp`, `haskell-language-server`, `elixir-ls` |
| **npm 패키지** | `typescript`, `vue`, `svelte`, `astro`, `yaml-ls`, `pyright`, `php intelephense`, `bash`, `dockerfile`, `biome`\*, `oxlint`\* |
| **HashiCorp releases** | `terraform` |
| **JetBrains CDN** | `kotlin-ls` |
| **Eclipse Foundation** | `jdtls` |
| **GitHub source zip** | `eslint` |
| **.NET tools (NuGet)** | `csharp`, `fsharp` |
| **RubyGems** | `ruby-lsp` |

\* 메인 패키지와 함께 타겟별로 맞는 `optionalDependencies` 네이티브 서브패키지도 다운로드합니다.

### Toolchain 전용 (9) — 타겟에 해당 언어 SDK가 있어야 함

`deno`, `gopls`, `dart`, `gleam`, `julials`, `prisma`, `nixd`, `sourcekit-lsp`, `ocaml-lsp`

이 LSP들은 해당 언어 툴체인에 포함되어 있습니다(예: `deno lsp`는 Deno 자체에 포함). `oalsp config`는 툴체인 바이너리가 PATH에 있다고 가정하고 설정 엔트리는 여전히 내보냅니다.

## 플랫폼 / 아키텍처 매트릭스

타겟: `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`.

대부분의 LSP가 6개 전부를 커버하지만, 몇 가지 예외:

- `clangd` — 업스트림이 x64 prebuilt만 배포.
- `haskell-language-server` — `linux-arm64` / `win32-arm64` 업스트림 에셋 없음.
- `zls` — `darwin-*-x86` (32비트) 에셋 없음, arm64 + x64만.

`oalsp fetch`는 에셋이 없는 조합은 건너뛰고 `manifest.json`의 `failed`에 기록합니다.

## 타겟 머신 요구사항

인터넷은 필요 없지만, 몇몇 LSP는 여전히 미리 설치된 도구에 의존합니다:

| LSP | 타겟에 필요한 것 |
|---|---|
| Node 기반 전부 (typescript, pyright, vue, …) | PATH에 `node` |
| `gopls` | Go SDK (toolchain 전용) |
| `ruby-lsp` | Ruby + `gem` (번들된 `.gem`을 오프라인 설치에 사용) |
| `csharp`, `fsharp` | .NET SDK (번들된 `.nupkg`을 오프라인 설치에 사용) |
| `jdtls`, `kotlin-ls` | Java 21+ |
| `eslint` | `node` + `npm` (설치 후 한 번 `npm install --omit=dev && npm run compile` 필요 — 아래 참고) |
| `elixir-ls` | prebuilt의 OTP 버전에 맞는 Erlang/Elixir |
| toolchain 전용 LSP | 각 언어 SDK |

## opencode 통합

`oalsp config`는 다음과 같은 내용을 생성합니다:

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
    // …번들 가능한 27개 + toolchain 9개 엔트리, 나머지는 `{ disabled: true }`
  }
}
```

opencode가 네트워크 대신 이 설정을 신뢰하도록 실행 전에 `OPENCODE_DISABLE_LSP_DOWNLOAD=true`를 내보내세요.

## 업스트림 동기화

`src/registry.ts`는 opencode `server.ts`를 손으로 미러링한 스냅샷입니다. 세 가지 가드레일로 정합성을 유지합니다:

- **`./UPSTREAM`** — 레지스트리가 기준으로 삼는 opencode 커밋(`UPSTREAM_SHA`)을 기록.
- **`bun run check-drift`** — 업스트림 `server.ts`를 TypeScript 컴파일러 API로 파싱해 id 집합과 `extensions` 배열 리터럴을 레지스트리와 비교, drift 발견 시 non-zero로 종료.
- **CI** (`.github/workflows/`):
  - `verify.yml` — push/PR 시, 고정 커밋 기준으로 typecheck + drift 체크.
  - `upstream-drift.yml` — 주간 cron + 수동 실행, 업스트림 HEAD 기준으로 검사해 drift가 생기면 단일 추적 이슈를 열거나 업데이트(해결되면 자동 close).

### 업스트림이 바뀌었을 때

```sh
# 1. 최신 opencode 받기 (sibling 체크아웃 가정)
cd ../opencode && git pull && cd ../opencode-airgap-lsp

# 2. 뭐가 바뀌었는지 확인
bun run check-drift

# 3. src/registry.ts 업데이트 후 ./UPSTREAM의 UPSTREAM_SHA 갱신

# 4. 클린한지 확인
bun run verify
```

`check-drift`가 **검증하지 않는 것**: command/args, initialization options, `root` 함수. 이들은 `server.ts`의 `spawn()` 본문에서 명령형으로 만들어지고, 추출하려 하면 리팩터만 있어도 깨지기 때문입니다. 이 부분은 opencode가 LSP를 spawn할 때 런타임 에러로 드러납니다.

## 개발

```sh
bun install
bun run typecheck            # tsc --noEmit
bun run check-drift          # 로컬 opencode 체크아웃 필요
bun run verify               # typecheck + check-drift
bun run cli list             # 레지스트리 sanity-check
bun run cli fetch --only pyright --targets win32-x64   # 가장 작은 round-trip
```

코드 구조:

```
src/
  cli.ts               command dispatch + arg parsing
  types.ts             Target, Source, LspEntry, FetchedArtifact, OpencodeLspConfig
  registry.ts          LSP 36개 엔트리 + INTENTIONALLY_SKIPPED_UPSTREAM
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
    fetch.ts           타겟별 다운로드 루프 + manifest
    bundle.ts          타겟별 tar.gz
    install.ts         검증 + LSP별 추출/배치
    config.ts          opencode.jsonc 생성기
scripts/
  check-drift.ts       TS 컴파일러 API로 업스트림 server.ts AST diff
.github/workflows/
  verify.yml           push/PR: 고정 SHA 기준 typecheck + drift
  upstream-drift.yml   cron: HEAD 기준 drift + 이슈 관리
UPSTREAM                고정 업스트림 커밋 + 저장소 URL
```

## 알려진 제약

- **eslint는 타겟에서 빌드 단계가 필요합니다.** vscode-eslint가 TypeScript 소스로 배포되기 때문에, `oalsp install` 후 `<prefix>/eslint/` 안에서 `npm install --omit=dev && npm run compile`을 한 번 돌려야 합니다. 타겟에 네트워크가 정말 하나도 없다면 `node_modules/`를 미리 채워 넣는 건 추후 과제입니다.
- **elixir-ls OTP 매칭.** prebuilt 릴리스는 특정 Erlang/OTP 버전에 맞춰 컴파일돼 있어서, 타겟의 Elixir도 맞아야 합니다.
- **arm64의 `clangd` / `haskell-language-server`.** 일부 arm64 조합은 업스트림에 prebuilt가 없습니다(위 매트릭스 참고).
- **`ty`는 번들에 포함되지 않습니다.** 원한다면 opencode의 `OPENCODE_EXPERIMENTAL_LSP_TY`를 켜고 venv에 직접 설치하세요.
- **심볼릭 링크 + Windows.** install 단계는 심링크를 만들지 않습니다. 모든 LSP는 추출된 바이너리 경로로 생성된 설정에서 참조됩니다.

## 라이선스

TBD.
