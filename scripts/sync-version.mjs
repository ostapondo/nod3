#!/usr/bin/env node
// version.env is the single source of truth (same convention as Plonk).
// This copies it into every package.json so nothing drifts.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const env = await readFile(path.join(ROOT, 'version.env'), 'utf8')
const version = env.match(/^VERSION=(.+)$/m)?.[1]?.trim()

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`version.env has no valid semver VERSION (got: ${version ?? 'nothing'})`)
  process.exit(1)
}

const targets = ['package.json', 'apps/server/package.json', 'apps/web/package.json']
let changed = 0

for (const rel of targets) {
  const file = path.join(ROOT, rel)
  const pkg = JSON.parse(await readFile(file, 'utf8'))
  if (pkg.version === version) continue
  pkg.version = version
  await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  console.log(`  ${rel} → ${version}`)
  changed++
}

console.log(changed === 0 ? `Already at ${version}.` : `Synced ${changed} file(s) to ${version}.`)
