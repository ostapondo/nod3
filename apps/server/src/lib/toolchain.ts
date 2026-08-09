import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'

const run = promisify(execFile)

/**
 * Resolves the compilers each language needs.
 *
 * Presence on disk is not enough: macOS ships `/usr/bin/javac` as a stub that
 * exits with "Unable to locate a Java Runtime" when no JDK is installed. Every
 * candidate is therefore probed by running it.
 */

export interface Toolchain {
  /** Absolute paths of the binaries this language needs, once verified. */
  bins: Record<string, string>
  available: boolean
  version?: string
  /** Shown in the UI when the language is unavailable. */
  install: string
}

async function probe(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(bin, args, { timeout: 15_000 })
    return (stdout || stderr).split('\n')[0]?.trim() ?? ''
  } catch {
    return null
  }
}

/** First candidate that exists AND runs. */
async function firstWorking(
  candidates: string[],
  args: string[],
): Promise<{ bin: string; version: string } | null> {
  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue
    const version = await probe(candidate, args)
    if (version !== null) return { bin: candidate, version }
  }
  return null
}

function javaCandidates(tool: 'javac' | 'java'): string[] {
  const out: string[] = []
  if (process.env.JAVA_HOME) out.push(path.join(process.env.JAVA_HOME, 'bin', tool))
  out.push(
    `/opt/homebrew/opt/openjdk/bin/${tool}`,
    `/usr/local/opt/openjdk/bin/${tool}`,
    `/opt/homebrew/bin/${tool}`,
    tool,
  )
  return out
}

let cache: Record<string, Toolchain> | null = null

export async function detectToolchains(): Promise<Record<string, Toolchain>> {
  if (cache) return cache

  const python = await firstWorking([process.env.PYTHON_BIN ?? 'python3', 'python3'], ['-V'])
  const javac = await firstWorking(javaCandidates('javac'), ['-version'])
  const java = await firstWorking(javaCandidates('java'), ['-version'])
  const cpp = await firstWorking([process.env.CXX ?? 'clang++', 'clang++', 'g++'].filter(Boolean), [
    '--version',
  ])
  const go = await firstWorking([process.env.GO_BIN ?? 'go', 'go'], ['version'])

  cache = {
    python: {
      bins: python ? { python: python.bin } : {},
      available: Boolean(python),
      version: python?.version,
      install: 'python3 ships with macOS; on Linux: apt install python3',
    },
    javascript: {
      // The Node running this server is the interpreter.
      bins: { node: process.execPath },
      available: true,
      version: `Node ${process.versions.node}`,
      install: '',
    },
    typescript: {
      // Same Node: it erases the annotations rather than compiling them, so
      // there is nothing extra to install.
      bins: { node: process.execPath },
      available: true,
      version: `Node ${process.versions.node} (type stripping)`,
      install: '',
    },
    java: {
      bins: javac && java ? { javac: javac.bin, java: java.bin } : {},
      available: Boolean(javac && java),
      version: javac?.version,
      install: 'brew install openjdk',
    },
    cpp: {
      bins: cpp ? { cxx: cpp.bin } : {},
      available: Boolean(cpp),
      version: cpp?.version,
      install: 'xcode-select --install (macOS) or apt install g++',
    },
    go: {
      bins: go ? { go: go.bin } : {},
      available: Boolean(go),
      version: go?.version,
      install: 'brew install go',
    },
  }
  return cache
}

/** Forget the cached probe — used by tests and after a toolchain install. */
export function resetToolchainCache(): void {
  cache = null
}
