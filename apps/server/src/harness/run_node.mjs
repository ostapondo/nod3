// Runs a candidate solution against test cases and prints a JSON verdict.
// Invoked as: node run_node.mjs <solution.js|solution.ts> <entryFn> <tests.json>
import { readFileSync } from 'node:fs'
import module from 'node:module'
import vm from 'node:vm'

const [solutionPath, entry, testsPath] = process.argv.slice(2)
const tests = JSON.parse(readFileSync(testsPath, 'utf8'))

let source = readFileSync(solutionPath, 'utf8')

if (solutionPath.endsWith('.ts')) {
  // Node can erase type annotations without a compiler. It refuses `enum` and
  // `namespace`, which need real code generation — neither belongs in an
  // interview answer, so say so plainly rather than dumping a Node stack.
  if (typeof module.stripTypeScriptTypes !== 'function') {
    console.log(
      JSON.stringify({
        error: 'compile',
        message: `This Node (v${process.versions.node}) cannot erase TypeScript annotations; that arrived in Node 22.13. Upgrade Node, or sit this problem in JavaScript.`,
        results: [],
      }),
    )
    process.exit(0)
  }

  try {
    source = module.stripTypeScriptTypes(source, { mode: 'strip' })
  } catch (err) {
    const detail = String(err?.message ?? err)
    console.log(
      JSON.stringify({
        error: 'compile',
        message: /enum|namespace/i.test(detail)
          ? `${detail}\n\nThis runner erases types rather than compiling them, so \`enum\` and \`namespace\` are not available. Use a union of literals or a plain object instead.`
          : detail,
        results: [],
      }),
    )
    process.exit(0)
  }
}

function normalise(value) {
  if (Array.isArray(value)) return value.map(normalise)
  if (value instanceof Set) return [...value].map(normalise).sort()
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [k, normalise(v)]))
  return value
}

const deepEqual = (a, b) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))

const context = vm.createContext({
  console: { log: () => {}, error: () => {}, warn: () => {} },
  Math,
  JSON,
  Map,
  Set,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Infinity,
  NaN,
  BigInt,
  Date,
  RegExp,
  Error,
  TypeError,
  RangeError,
  Symbol,
})

// Accept snake_case or camelCase — the name should not be the obstacle.
const camel = entry.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
const variants = [entry, camel, camel[0].toUpperCase() + camel.slice(1)]

let fn
try {
  vm.runInContext(source, context, { timeout: 5000 })
  fn = variants.map((v) => context[v]).find((f) => typeof f === 'function')
} catch (err) {
  console.log(JSON.stringify({ error: 'compile', message: String(err?.stack ?? err), results: [] }))
  process.exit(0)
}

if (typeof fn !== 'function') {
  console.log(
    JSON.stringify({
      error: 'entry',
      message: `No function named \`${entry}\` found at top level.`,
      results: [],
    }),
  )
  process.exit(0)
}

const results = tests.map((testCase, index) => {
  const row = { index, hidden: Boolean(testCase.hidden), note: testCase.note ?? null }
  try {
    const got = fn(...structuredClone(testCase.args))
    row.passed = deepEqual(got, testCase.expected)
    row.got = normalise(got)
    row.expected = normalise(testCase.expected)
    row.args = testCase.args
  } catch (err) {
    row.passed = false
    row.error = String(err?.message ?? err)
    row.args = testCase.args
    row.expected = normalise(testCase.expected)
  }
  return row
})

console.log(JSON.stringify({ error: null, results }))
