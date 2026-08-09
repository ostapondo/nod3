import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cppHarness,
  cppPrelude,
  goHarness,
  javaHarness,
  starterFor,
  typescriptStarter,
} from './codegen.js'
import { detectToolchains } from './toolchain.js'
import type { Problem } from './types.js'

const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../harness')

/**
 * The languages Google lets you interview in. Python and JavaScript run through
 * a generic harness that decodes the test JSON at runtime; the typed three get
 * a harness generated from the problem's declared signature.
 */
export const LANGUAGES = {
  python: { ext: 'py', label: 'Python', monaco: 'python' },
  javascript: { ext: 'js', label: 'JavaScript', monaco: 'javascript' },
  typescript: { ext: 'ts', label: 'TypeScript', monaco: 'typescript' },
  java: { ext: 'java', label: 'Java', monaco: 'java' },
  cpp: { ext: 'cpp', label: 'C++', monaco: 'cpp' },
  go: { ext: 'go', label: 'Go', monaco: 'go' },
} as const

export type Language = keyof typeof LANGUAGES

export function isLanguage(v: string): v is Language {
  return v in LANGUAGES
}

/** Starters for the typed languages are derived, not stored per problem. */
export function starterCode(problem: Problem, language: Language): string {
  if (language === 'python' || language === 'javascript') {
    return problem.starter[language] ?? ''
  }
  if (language === 'typescript') return typescriptStarter(problem)
  return starterFor(problem, language)
}

export interface CaseResult {
  index: number
  hidden: boolean
  note: string | null
  passed: boolean
  got?: unknown
  expected?: unknown
  args?: unknown[]
  error?: string
}

export interface RunResult {
  error: 'compile' | 'entry' | 'crash' | 'timeout' | 'unavailable' | null
  message?: string
  results: CaseResult[]
  passed: number
  total: number
}

const COMPILE_TIMEOUT_MS = 60_000
const RUN_TIMEOUT_MS = 30_000

interface Exec {
  stdout: string
  stderr: string
  timedOut: boolean
  failed: boolean
}

function exec(bin: string, args: string[], cwd: string, timeout: number): Promise<Exec> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({
        stdout,
        stderr,
        timedOut: Boolean(err && (err as NodeJS.ErrnoException).code === 'ETIMEDOUT'),
        failed: Boolean(err),
      }),
    )
  })
}

/** Compiled harnesses print one JSON object per line. */
function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      rows.push(JSON.parse(trimmed))
    } catch {
      // A stray println from the candidate's own debugging. Not our business.
    }
  }
  return rows
}

function assemble(problem: Problem, rows: Array<Record<string, unknown>>): RunResult {
  const byIndex = new Map(rows.map((r) => [Number(r.index), r]))
  const results: CaseResult[] = problem.tests.map((test, index) => {
    const row = byIndex.get(index)
    return {
      index,
      hidden: Boolean(test.hidden),
      note: test.note ?? null,
      // A missing row means the process died partway through — that case did
      // not pass, and saying so beats silently dropping it.
      passed: Boolean(row?.passed),
      got: row?.got,
      expected: test.expected,
      args: test.args,
      error: row ? (row.error as string | undefined) : 'no result — the program stopped early',
    }
  })
  return {
    error: null,
    results,
    passed: results.filter((r) => r.passed).length,
    total: problem.tests.length,
  }
}

function fail(error: NonNullable<RunResult['error']>, message: string, total: number): RunResult {
  return { error, message: message.slice(0, 6000), results: [], passed: 0, total }
}

/**
 * Executes the candidate's solution against the problem's tests.
 *
 * This runs unsandboxed on your machine — it is your own code, the same trust
 * model as running it in your editor. Do not point it at code you did not write.
 */
export async function runTests(
  code: string,
  problem: Problem,
  language: Language,
  workDir: string,
): Promise<RunResult> {
  const total = problem.tests.length
  const chains = await detectToolchains()
  const chain = chains[language]
  if (!chain?.available) {
    return fail(
      'unavailable',
      `${LANGUAGES[language].label} is not set up on this machine. Install it with: ${chain?.install ?? 'see the README'}`,
      total,
    )
  }

  const build = path.join(workDir, `build-${language}`)
  await rm(build, { recursive: true, force: true })
  await mkdir(build, { recursive: true })

  switch (language) {
    case 'python':
    case 'javascript':
    case 'typescript': {
      const { ext } = LANGUAGES[language]
      const solutionPath = path.join(workDir, `solution.${ext}`)
      const testsPath = path.join(build, 'tests.json')
      await writeFile(solutionPath, code, 'utf8')
      await writeFile(testsPath, JSON.stringify(problem.tests), 'utf8')

      const [bin, args] =
        language === 'python'
          ? [
              chain.bins.python!,
              [path.join(HARNESS_DIR, 'run_python.py'), solutionPath, problem.entry, testsPath],
            ]
          : [
              process.execPath,
              [
                // Type stripping is still flagged experimental; the warning
                // would be the only thing on stderr for a clean run.
                '--no-warnings',
                path.join(HARNESS_DIR, 'run_node.mjs'),
                solutionPath,
                problem.entry,
                testsPath,
              ],
            ]

      const out = await exec(bin, args, build, RUN_TIMEOUT_MS)
      if (out.timedOut) return fail('timeout', 'Your solution ran too long and was stopped.', total)

      try {
        const parsed = JSON.parse(out.stdout.trim().split('\n').pop() ?? '') as {
          error: RunResult['error']
          message?: string
          results: CaseResult[]
        }
        if (parsed.error) return fail(parsed.error, parsed.message ?? '', total)
        return {
          error: null,
          results: parsed.results,
          passed: parsed.results.filter((r) => r.passed).length,
          total,
        }
      } catch {
        return fail('crash', out.stderr || out.stdout || 'The runner produced no output.', total)
      }
    }

    case 'java': {
      // User code first so their imports stay at the top of the file; the
      // harness class is appended and is the only public one.
      await writeFile(
        path.join(build, 'Main.java'),
        `${code}\n${javaHarness(problem, problem.tests)}`,
        'utf8',
      )
      const compiled = await exec(
        chain.bins.javac!,
        ['-nowarn', '-d', build, 'Main.java'],
        build,
        COMPILE_TIMEOUT_MS,
      )
      if (compiled.failed) {
        return fail('compile', compiled.stderr || compiled.stdout || 'javac failed', total)
      }
      const out = await exec(chain.bins.java!, ['-cp', build, 'Main'], build, RUN_TIMEOUT_MS)
      if (out.timedOut) return fail('timeout', 'Your solution ran too long and was stopped.', total)
      const rows = parseJsonLines(out.stdout)
      if (rows.length === 0) {
        return fail('crash', out.stderr || out.stdout || 'The program printed nothing.', total)
      }
      return assemble(problem, rows)
    }

    case 'cpp': {
      await writeFile(
        path.join(build, 'main.cpp'),
        `${cppPrelude()}${code}\n${cppHarness(problem, problem.tests)}`,
        'utf8',
      )
      const compiled = await exec(
        chain.bins.cxx!,
        ['-std=c++17', '-O1', '-w', '-o', 'solution', 'main.cpp'],
        build,
        COMPILE_TIMEOUT_MS,
      )
      if (compiled.failed) {
        return fail('compile', compiled.stderr || compiled.stdout || 'the compiler failed', total)
      }
      const out = await exec(path.join(build, 'solution'), [], build, RUN_TIMEOUT_MS)
      if (out.timedOut) return fail('timeout', 'Your solution ran too long and was stopped.', total)
      const rows = parseJsonLines(out.stdout)
      if (rows.length === 0) {
        // A segfault kills the process without an exception to catch.
        return fail(
          'crash',
          out.stderr || 'The program crashed before printing anything (a segfault, most likely).',
          total,
        )
      }
      return assemble(problem, rows)
    }

    case 'go': {
      // Two files in one package: the candidate keeps their own import block,
      // and the harness keeps its own, which Go requires to be exactly used.
      await writeFile(path.join(build, 'go.mod'), 'module nod3\n\ngo 1.21\n', 'utf8')
      await writeFile(path.join(build, 'solution.go'), `package main\n\n${code}`, 'utf8')
      await writeFile(path.join(build, 'main.go'), goHarness(problem, problem.tests), 'utf8')

      const out = await exec(
        chain.bins.go!,
        ['run', '.'],
        build,
        COMPILE_TIMEOUT_MS + RUN_TIMEOUT_MS,
      )
      if (out.timedOut) return fail('timeout', 'Your solution ran too long and was stopped.', total)
      const rows = parseJsonLines(out.stdout)
      if (rows.length === 0) {
        return fail('compile', out.stderr || out.stdout || 'go run produced no output', total)
      }
      return assemble(problem, rows)
    }
  }
}
