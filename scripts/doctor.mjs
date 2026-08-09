#!/usr/bin/env node
// Checks that everything the app shells out to is actually present, and says
// exactly how to fix whatever is not. Run this first when something misbehaves.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
let warnings = 0

function ok(label, detail = '') {
  console.log(`${GREEN}  ok${RESET}   ${label} ${DIM}${detail}${RESET}`)
}
function bad(label, fix) {
  failures++
  console.log(`${RED} fail${RESET}   ${label}`)
  console.log(`${DIM}         fix: ${fix}${RESET}`)
}
function warn(label, detail) {
  warnings++
  console.log(`${YELLOW} warn${RESET}   ${label}`)
  console.log(`${DIM}         ${detail}${RESET}`)
}

async function which(bin) {
  try {
    // `sh -c` rather than `shell: true`, which concatenates args unescaped.
    const { stdout } = await run('/bin/sh', ['-c', `command -v ${JSON.stringify(bin)}`])
    return stdout.trim()
  } catch {
    return null
  }
}

console.log('\nnod3 doctor\n')

// --- node ---
// 22.13 is the floor because that is where `module.stripTypeScriptTypes` — the
// whole of the TypeScript harness — arrived.
const [major, minor] = process.versions.node.split('.').map(Number)
if (major > 22 || (major === 22 && minor >= 13)) ok('node', `v${process.versions.node}`)
else bad(`node v${process.versions.node} is too old`, 'install Node 22.13 or newer')

// --- ffmpeg: audio conversion and silence detection ---
const ffmpeg = await which('ffmpeg')
if (ffmpeg) ok('ffmpeg', ffmpeg)
else bad('ffmpeg not found', 'brew install ffmpeg')

// --- whisper.cpp ---
const whisper = await which('whisper-cli')
if (whisper) ok('whisper-cli', whisper)
else bad('whisper-cli not found', 'brew install whisper-cpp')

// --- whisper model ---
const modelsDir = path.join(ROOT, 'models')
const models = existsSync(modelsDir) ? readdirSync(modelsDir).filter((f) => f.endsWith('.bin')) : []
if (models.length > 0) ok('whisper model', models.join(', '))
else bad('no whisper model downloaded', 'npm run setup:model')

// --- interview languages -----------------------------------------------
// Google lets you interview in any of these. A missing one is a warning, not a
// failure: you only need the language you actually plan to use.
console.log(`${DIM}         interview languages:${RESET}`)

const LANGUAGES = [
  {
    label: 'Python',
    probe: [['python3', ['-V']]],
    install: 'ships with macOS; apt install python3',
  },
  { label: 'JavaScript', probe: 'builtin', install: '' },
  {
    label: 'Java',
    probe: [
      [`${process.env.JAVA_HOME ?? ''}/bin/javac`, ['-version']],
      ['/opt/homebrew/opt/openjdk/bin/javac', ['-version']],
      ['/usr/local/opt/openjdk/bin/javac', ['-version']],
      ['javac', ['-version']],
    ],
    install: 'brew install openjdk',
  },
  {
    label: 'C++',
    probe: [
      ['clang++', ['--version']],
      ['g++', ['--version']],
    ],
    install: 'xcode-select --install, or apt install g++',
  },
  { label: 'Go', probe: [['go', ['version']]], install: 'brew install go' },
]

for (const lang of LANGUAGES) {
  if (lang.probe === 'builtin') {
    ok(`  ${lang.label}`, `Node ${process.versions.node}`)
    continue
  }
  let found = null
  for (const [bin, args] of lang.probe) {
    if (bin.startsWith('/') && !existsSync(bin)) continue
    // Presence is not enough: macOS ships a javac stub that fails without a JDK.
    try {
      const { stdout, stderr } = await run(bin, args, { timeout: 15_000 })
      found = (stdout || stderr).split('\n')[0].trim()
      break
    } catch {
      /* try the next candidate */
    }
  }
  if (found) ok(`  ${lang.label}`, found)
  else warn(`  ${lang.label} unavailable`, `install with: ${lang.install}`)
}

// --- analysis engine ---
const engine = process.env.ANALYSIS_ENGINE ?? 'claude-code'
if (engine === 'claude-code') {
  const claude = await which('claude')
  if (claude) {
    ok('analysis engine', `claude-code (${claude})`)
  } else {
    bad(
      'ANALYSIS_ENGINE=claude-code but the `claude` CLI is missing',
      'install Claude Code, or set ANALYSIS_ENGINE=anthropic with ANTHROPIC_API_KEY, or ANALYSIS_ENGINE=ollama',
    )
  }
} else if (engine === 'anthropic') {
  if (process.env.ANTHROPIC_API_KEY) ok('analysis engine', 'anthropic (key present)')
  else bad('ANALYSIS_ENGINE=anthropic but ANTHROPIC_API_KEY is unset', 'export ANTHROPIC_API_KEY=…')
} else if (engine === 'ollama') {
  const url = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
  try {
    const res = await fetch(`${url}/api/tags`)
    if (res.ok) ok('analysis engine', `ollama at ${url}`)
    else bad(`ollama at ${url} returned ${res.status}`, 'start it with: ollama serve')
  } catch {
    bad(`cannot reach ollama at ${url}`, 'start it with: ollama serve')
  }
}

// --- microphone reminder (cannot be checked from Node) ---
console.log(
  `${DIM}  note   the browser asks for microphone access on the first session;` +
    ` macOS also needs it granted to your browser in System Settings → Privacy${RESET}`,
)

console.log()
if (failures > 0) {
  console.log(`${RED}${failures} problem(s) must be fixed before a session will work.${RESET}\n`)
  process.exit(1)
}
console.log(`${GREEN}Ready.${RESET}${warnings ? ` ${warnings} warning(s).` : ''}\n`)
