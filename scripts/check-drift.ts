#!/usr/bin/env bun
/**
 * Check that src/registry.ts is in sync with opencode's server.ts.
 *
 * What we can reliably extract from server.ts via AST parsing:
 *   - The set of exported `Info` objects (i.e. every LSP opencode knows about)
 *   - Each LSP's literal `id` and `extensions` arrays
 *
 * What we cannot reliably extract (and therefore do not check):
 *   - `command`/`args` — these are constructed imperatively inside each `spawn()` body
 *     via conditionals, variables, and platform branches. Extracting them would require
 *     a symbolic executor and would break constantly on benign refactors. If the command
 *     changes in a way that breaks our config, the user's opencode run will surface it;
 *     it's caught at integration time, not here.
 *   - `initialization` options — same reason (constructed conditionally).
 *   - `root` function — we don't mirror this anyway; opencode inherits it when the
 *     config entry's id matches a built-in.
 *
 * What we DO check:
 *   1. Every opencode LSP id exists in our REGISTRY (or in INTENTIONALLY_SKIPPED_UPSTREAM).
 *   2. Every REGISTRY id exists in opencode (catch removed/renamed upstream LSPs).
 *   3. If an LSP declares `extensions` literally in server.ts, our extensions (if set)
 *      match exactly.
 *
 * Exit codes:
 *   0 = in sync
 *   1 = drift detected (report printed)
 *   2 = internal error (couldn't parse upstream or load registry)
 *
 * Usage:
 *   bun run check-drift                                 # uses default ../opencode
 *   bun run check-drift --opencode /path/to/opencode
 *   bun run check-drift --server /path/to/server.ts
 */

import path from "node:path"
import fs from "node:fs"
import ts from "typescript"
import { REGISTRY, INTENTIONALLY_SKIPPED_UPSTREAM } from "../src/registry.ts"

interface UpstreamEntry {
  exportName: string
  id: string
  /** Undefined if extensions isn't a simple literal array in source. */
  extensions: string[] | undefined
  sourceLine: number
}

interface DriftReport {
  missingInRegistry: Array<{ id: string; upstream: UpstreamEntry }>
  missingInUpstream: string[]
  extensionMismatch: Array<{ id: string; upstream: string[]; registry: string[] }>
}

function parseArgs(argv: string[]): { opencode?: string; server?: string } {
  const args: { opencode?: string; server?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === "--opencode") args.opencode = argv[++i]
    else if (tok === "--server") args.server = argv[++i]
    else if (tok === "-h" || tok === "--help") {
      console.log("Usage: check-drift [--opencode <dir>] [--server <server.ts>]")
      process.exit(0)
    }
  }
  return args
}

function resolveServerPath(opts: { opencode?: string; server?: string }): string {
  if (opts.server) return path.resolve(opts.server)
  // Default: assume opencode clone is a sibling of this project.
  const opencodeRoot = opts.opencode
    ? path.resolve(opts.opencode)
    : path.resolve(import.meta.dir, "..", "..", "opencode")
  return path.join(opencodeRoot, "packages", "opencode", "src", "lsp", "server.ts")
}

function extractUpstreamEntries(serverTsPath: string): UpstreamEntry[] {
  const source = fs.readFileSync(serverTsPath, "utf8")
  const sf = ts.createSourceFile(serverTsPath, source, ts.ScriptTarget.Latest, true)

  const entries: UpstreamEntry[] = []

  const visit = (node: ts.Node) => {
    // Match: `export const <Name>: Info = { ... }`
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isVariableDeclaration(decl)) continue
        if (!decl.type || !ts.isTypeReferenceNode(decl.type)) continue
        if (decl.type.typeName.getText(sf) !== "Info") continue
        if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.name)) continue

        const idVal = findStringProperty(decl.initializer, "id", sf)
        if (!idVal) {
          console.warn(
            `  [warn] upstream const '${decl.name.text}' has Info type but no literal id — skipped`,
          )
          continue
        }

        const extensions = findStringArrayProperty(decl.initializer, "extensions", sf)
        const { line } = sf.getLineAndCharacterOfPosition(decl.getStart(sf))
        entries.push({
          exportName: decl.name.text,
          id: idVal,
          extensions,
          sourceLine: line + 1,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return entries
}

function findStringProperty(
  obj: ts.ObjectLiteralExpression,
  key: string,
  sf: ts.SourceFile,
): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = propertyName(prop, sf)
    if (name !== key) continue
    if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
      return prop.initializer.text
    }
  }
  return undefined
}

function findStringArrayProperty(
  obj: ts.ObjectLiteralExpression,
  key: string,
  sf: ts.SourceFile,
): string[] | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = propertyName(prop, sf)
    if (name !== key) continue
    if (!ts.isArrayLiteralExpression(prop.initializer)) return undefined
    const out: string[] = []
    for (const elem of prop.initializer.elements) {
      if (ts.isStringLiteral(elem) || ts.isNoSubstitutionTemplateLiteral(elem)) {
        out.push(elem.text)
      } else {
        // Array contains a non-literal — bail out on comparison to avoid false positives.
        return undefined
      }
    }
    return out
  }
  return undefined
}

function propertyName(prop: ts.PropertyAssignment, sf: ts.SourceFile): string {
  return prop.name.getText(sf).replace(/^["']|["']$/g, "")
}

function computeDrift(upstream: UpstreamEntry[]): DriftReport {
  const report: DriftReport = {
    missingInRegistry: [],
    missingInUpstream: [],
    extensionMismatch: [],
  }

  const skipSet = new Set(INTENTIONALLY_SKIPPED_UPSTREAM.map((s) => s.id))
  const upstreamById = new Map(upstream.map((e) => [e.id, e]))
  const registryIds = new Set(REGISTRY.map((e) => e.id))

  // 1. upstream → registry: anything upstream has that we don't (and isn't skipped)
  for (const up of upstream) {
    if (skipSet.has(up.id)) continue
    if (!registryIds.has(up.id)) {
      report.missingInRegistry.push({ id: up.id, upstream: up })
    }
  }

  // 2. registry → upstream: anything we have that upstream no longer does
  for (const entry of REGISTRY) {
    if (!upstreamById.has(entry.id)) {
      report.missingInUpstream.push(entry.id)
    }
  }

  // 3. Extensions comparison (only for ids present on both sides, where both declare extensions)
  for (const entry of REGISTRY) {
    const up = upstreamById.get(entry.id)
    if (!up || !up.extensions || !entry.extensions) continue
    if (!arrayEq(up.extensions, entry.extensions)) {
      report.extensionMismatch.push({
        id: entry.id,
        upstream: up.extensions,
        registry: entry.extensions,
      })
    }
  }

  return report
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bs = new Set(b)
  return a.every((x) => bs.has(x))
}

function printReport(report: DriftReport, upstream: UpstreamEntry[], serverTsPath: string): boolean {
  const driftCount =
    report.missingInRegistry.length +
    report.missingInUpstream.length +
    report.extensionMismatch.length

  console.log(`Checked: ${serverTsPath}`)
  console.log(`Upstream LSPs found: ${upstream.length}`)
  console.log(`Registry LSPs:       ${REGISTRY.length}`)
  console.log(`Intentionally skipped (INTENTIONALLY_SKIPPED_UPSTREAM): ${INTENTIONALLY_SKIPPED_UPSTREAM.length}`)
  console.log()

  if (driftCount === 0) {
    console.log("✓ No drift detected.")
    return true
  }

  console.log(`✗ Drift detected (${driftCount} issue${driftCount === 1 ? "" : "s"}):`)
  console.log()

  if (report.missingInRegistry.length > 0) {
    console.log(`  Missing in registry.ts (upstream added or renamed):`)
    for (const m of report.missingInRegistry) {
      const extHint = m.upstream.extensions ? ` extensions=[${m.upstream.extensions.join(", ")}]` : ""
      console.log(`    - ${m.id.padEnd(28)} (${m.upstream.exportName} at server.ts:${m.upstream.sourceLine})${extHint}`)
    }
    console.log()
  }

  if (report.missingInUpstream.length > 0) {
    console.log(`  Missing in upstream (removed or renamed upstream):`)
    for (const id of report.missingInUpstream) {
      console.log(`    - ${id}`)
    }
    console.log()
  }

  if (report.extensionMismatch.length > 0) {
    console.log(`  Extensions differ:`)
    for (const m of report.extensionMismatch) {
      console.log(`    - ${m.id}`)
      console.log(`        upstream: [${m.upstream.join(", ")}]`)
      console.log(`        registry: [${m.registry.join(", ")}]`)
    }
    console.log()
  }

  console.log(`How to resolve:`)
  console.log(`  1. Update src/registry.ts to match upstream (add/remove/update entries).`)
  console.log(`  2. If an upstream LSP should be intentionally skipped, add it to`)
  console.log(`     INTENTIONALLY_SKIPPED_UPSTREAM in src/registry.ts with a reason.`)
  console.log(`  3. Update UPSTREAM_SHA in ./UPSTREAM to the opencode commit you mirrored.`)
  console.log(`  4. Re-run 'bun run check-drift' to confirm clean.`)

  return false
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const serverTsPath = resolveServerPath(opts)

  if (!fs.existsSync(serverTsPath)) {
    console.error(`Upstream server.ts not found: ${serverTsPath}`)
    console.error(`Pass --opencode <dir> or --server <file> to point at an opencode checkout.`)
    process.exit(2)
  }

  let upstream: UpstreamEntry[]
  try {
    upstream = extractUpstreamEntries(serverTsPath)
  } catch (err) {
    console.error(`Failed to parse upstream server.ts: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }

  const report = computeDrift(upstream)
  const clean = printReport(report, upstream, serverTsPath)
  process.exit(clean ? 0 : 1)
}

main()
