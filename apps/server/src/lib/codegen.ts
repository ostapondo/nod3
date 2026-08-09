import type { Problem, SigType, TestCase } from './types.js'

/**
 * Java, C++ and Go are statically typed, so a harness cannot decode `args`
 * generically the way the Python and JavaScript ones do. Instead the test data
 * is baked into the generated source as literals, using the `signature` each
 * problem declares. No JSON parser in three languages, no reflection.
 */

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function quote(value: string): string {
  return JSON.stringify(value)
}

// --------------------------------------------------------------- literals ---

type Emit = (value: unknown, type: SigType) => string

const javaLiteral: Emit = (value, type) => {
  switch (type) {
    case 'int':
      return String(value)
    case 'bool':
      return String(value)
    case 'string':
      return quote(String(value))
    case 'int[]':
      return `new int[]{${(value as number[]).join(', ')}}`
    case 'string[]':
      return `new String[]{${(value as string[]).map(quote).join(', ')}}`
    case 'int[][]':
      return `new int[][]{${(value as number[][]).map((row) => `{${row.join(', ')}}`).join(', ')}}`
  }
}

const cppLiteral: Emit = (value, type) => {
  switch (type) {
    case 'int':
      return String(value)
    case 'bool':
      return String(value)
    case 'string':
      return quote(String(value))
    case 'int[]':
      return `vector<int>{${(value as number[]).join(', ')}}`
    case 'string[]':
      return `vector<string>{${(value as string[]).map(quote).join(', ')}}`
    case 'int[][]':
      return `vector<vector<int>>{${(value as number[][])
        .map((row) => `{${row.join(', ')}}`)
        .join(', ')}}`
  }
}

const goLiteral: Emit = (value, type) => {
  switch (type) {
    case 'int':
      return String(value)
    case 'bool':
      return String(value)
    case 'string':
      return quote(String(value))
    case 'int[]':
      return `[]int{${(value as number[]).join(', ')}}`
    case 'string[]':
      return `[]string{${(value as string[]).map(quote).join(', ')}}`
    case 'int[][]':
      return `[][]int{${(value as number[][]).map((row) => `{${row.join(', ')}}`).join(', ')}}`
  }
}

// ------------------------------------------------------------ type names ---

const JAVA_TYPE: Record<SigType, string> = {
  int: 'int',
  bool: 'boolean',
  string: 'String',
  'int[]': 'int[]',
  'string[]': 'String[]',
  'int[][]': 'int[][]',
}

const CPP_TYPE: Record<SigType, string> = {
  int: 'int',
  bool: 'bool',
  string: 'string',
  'int[]': 'vector<int>',
  'string[]': 'vector<string>',
  'int[][]': 'vector<vector<int>>',
}

const GO_TYPE: Record<SigType, string> = {
  int: 'int',
  bool: 'bool',
  string: 'string',
  'int[]': '[]int',
  'string[]': '[]string',
  'int[][]': '[][]int',
}

// ---------------------------------------------------------------- starters ---

/**
 * Parameter names come from the Python stub's own signature rather than being
 * declared a second time on the problem — `merge_intervals(intervals)` reads a
 * lot better as `mergeIntervals(int[][] intervals)` than as `arg1`.
 */
function paramNames(problem: Problem): string[] {
  const declared = problem.starter.python?.match(/^def\s+\w+\s*\(([^)]*)\)/m)?.[1]
  const parsed = (declared ?? '')
    .split(',')
    .map((p) => p.trim().split(/[:=]/)[0]!.trim())
    .filter(Boolean)
  return problem.signature.params.map((_, i) => camel(parsed[i] ?? `arg${i + 1}`))
}

const TS_TYPE: Record<SigType, string> = {
  int: 'number',
  bool: 'boolean',
  string: 'string',
  'int[]': 'number[]',
  'string[]': 'string[]',
  'int[][]': 'number[][]',
}

/**
 * TypeScript keeps the JavaScript entry name — the bank's JS stubs are
 * snake_case — and gains the annotations, which is the point of choosing it.
 */
export function typescriptStarter(problem: Problem): string {
  const names = paramNames(problem)
  const args = problem.signature.params.map((t, i) => `${names[i]}: ${TS_TYPE[t]}`).join(', ')
  const hint = problem.starter.python?.match(/#\s*(.+)/)?.[1]
  return `function ${problem.entry}(${args}): ${TS_TYPE[problem.signature.returns]} {
  ${hint ? `// ${hint}\n  ` : ''}
}
`
}

export function starterFor(problem: Problem, language: 'java' | 'cpp' | 'go'): string {
  const sig = problem.signature
  const name = camel(problem.entry)
  const names = paramNames(problem)
  const params = sig.params.map((t, i) => ({ t, n: names[i]! }))
  const hint = problem.starter.python?.match(/#\s*(.+)/)?.[1]

  if (language === 'java') {
    const args = params.map((p) => `${JAVA_TYPE[p.t]} ${p.n}`).join(', ')
    return `import java.util.*;

class Solution {
    public ${JAVA_TYPE[sig.returns]} ${name}(${args}) {
        ${hint ? `// ${hint}\n        ` : ''}
    }
}
`
  }

  if (language === 'cpp') {
    const args = params.map((p) => `${CPP_TYPE[p.t]} ${p.n}`).join(', ')
    return `${CPP_TYPE[sig.returns]} ${name}(${args}) {
    ${hint ? `// ${hint}\n    ` : ''}
}
`
  }

  const args = params.map((p) => `${p.n} ${GO_TYPE[p.t]}`).join(', ')
  return `func ${name}(${args}) ${GO_TYPE[sig.returns]} {
	${hint ? `// ${hint}\n\t` : ''}
}
`
}

// ---------------------------------------------------------------- harnesses ---

/** Each harness prints one JSON object per line: the runner parses those. */

export function javaHarness(problem: Problem, tests: TestCase[]): string {
  const sig = problem.signature
  const name = camel(problem.entry)

  const cases = tests
    .map((t, i) => {
      const args = t.args.map((a, j) => javaLiteral(a, sig.params[j]!)).join(', ')
      const expected = javaLiteral(t.expected, sig.returns)
      return `        run(${i}, () -> new Solution().${name}(${args}), ${expected});`
    })
    .join('\n')

  return `
public class Main {
    interface Call { ${JAVA_TYPE[sig.returns]} get(); }

    static String json(${JAVA_TYPE[sig.returns]} v) {
${jsonBodyJava(sig.returns)}
    }

    static boolean eq(${JAVA_TYPE[sig.returns]} a, ${JAVA_TYPE[sig.returns]} b) {
${eqBodyJava(sig.returns)}
    }

    static String esc(String s) {
        StringBuilder b = new StringBuilder("\\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c == '\\n') b.append("\\\\n");
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static void run(int index, Call call, ${JAVA_TYPE[sig.returns]} expected) {
        try {
            ${JAVA_TYPE[sig.returns]} got = call.get();
            System.out.println("{\\"index\\":" + index + ",\\"passed\\":" + eq(got, expected)
                + ",\\"got\\":" + json(got) + "}");
        } catch (Throwable t) {
            System.out.println("{\\"index\\":" + index + ",\\"passed\\":false,\\"error\\":"
                + esc(t.getClass().getSimpleName() + ": " + t.getMessage()) + "}");
        }
    }

    public static void main(String[] args) {
${cases}
    }
}
`
}

function jsonBodyJava(type: SigType): string {
  switch (type) {
    case 'int':
      return '        return String.valueOf(v);'
    case 'bool':
      return '        return String.valueOf(v);'
    case 'string':
      return '        return v == null ? "null" : esc(v);'
    case 'int[]':
      return `        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();`
    case 'string[]':
      return `        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(esc(v[i])); }
        return b.append(']').toString();`
    case 'int[][]':
      return `        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) {
            if (i > 0) b.append(',');
            b.append('[');
            for (int j = 0; j < v[i].length; j++) { if (j > 0) b.append(','); b.append(v[i][j]); }
            b.append(']');
        }
        return b.append(']').toString();`
  }
}

function eqBodyJava(type: SigType): string {
  switch (type) {
    case 'int':
    case 'bool':
      return '        return a == b;'
    case 'string':
      return '        return a == null ? b == null : a.equals(b);'
    case 'int[]':
    case 'string[]':
      return '        return java.util.Arrays.equals(a, b);'
    case 'int[][]':
      return '        return java.util.Arrays.deepEquals(a, b);'
  }
}

export function cppPrelude(): string {
  // macOS clang has no <bits/stdc++.h>, so the usual competitive-programming
  // shortcut is not available; pull in what an interview answer plausibly uses.
  return `#include <algorithm>
#include <climits>
#include <cmath>
#include <deque>
#include <functional>
#include <iostream>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;

`
}

export function cppHarness(problem: Problem, tests: TestCase[]): string {
  const sig = problem.signature
  const name = camel(problem.entry)

  const cases = tests
    .map((t, i) => {
      const args = t.args.map((a, j) => cppLiteral(a, sig.params[j]!)).join(', ')
      const expected = cppLiteral(t.expected, sig.returns)
      return `    check(${i}, [&]{ return ${name}(${args}); }, ${expected});`
    })
    .join('\n')

  return `
namespace nod3 {

static string esc(const string& s) {
    string out = "\\"";
    for (char c : s) {
        if (c == '"' || c == '\\\\') { out += '\\\\'; out += c; }
        else if (c == '\\n') out += "\\\\n";
        else out += c;
    }
    return out + "\\"";
}

static string json(int v) { return to_string(v); }
static string json(bool v) { return v ? "true" : "false"; }
static string json(const string& v) { return esc(v); }
static string json(const vector<int>& v) {
    string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ","; out += to_string(v[i]); }
    return out + "]";
}
static string json(const vector<string>& v) {
    string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ","; out += esc(v[i]); }
    return out + "]";
}
static string json(const vector<vector<int>>& v) {
    string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ","; out += json(v[i]); }
    return out + "]";
}

template <typename F, typename T>
void check(int index, F fn, const T& expected) {
    try {
        T got = fn();
        cout << "{\\"index\\":" << index
             << ",\\"passed\\":" << ((got == expected) ? "true" : "false")
             << ",\\"got\\":" << json(got) << "}" << endl;
    } catch (const std::exception& e) {
        cout << "{\\"index\\":" << index << ",\\"passed\\":false,\\"error\\":"
             << esc(e.what()) << "}" << endl;
    } catch (...) {
        cout << "{\\"index\\":" << index
             << ",\\"passed\\":false,\\"error\\":\\"unknown exception\\"}" << endl;
    }
}

}  // namespace nod3

int main() {
    using nod3::check;
${cases}
    return 0;
}
`
}

export function goHarness(problem: Problem, tests: TestCase[]): string {
  const sig = problem.signature
  const name = camel(problem.entry)

  const cases = tests
    .map((t, i) => {
      const args = t.args.map((a, j) => goLiteral(a, sig.params[j]!)).join(', ')
      const expected = goLiteral(t.expected, sig.returns)
      return `\tcheck(${i}, func() ${GO_TYPE[sig.returns]} { return ${name}(${args}) }, ${expected})`
    })
    .join('\n')

  const sliceReturn = sig.returns.endsWith('[]')

  // A Go function that returns `nil` for an empty result is idiomatic and
  // correct; reflect.DeepEqual would call it unequal to an empty literal. Both
  // sides are normalised through JSON so nil and empty compare the same.
  const compare = sliceReturn
    ? `	gotJSON := normalise(got)
	expJSON := normalise(expected)
	fmt.Printf("{\\"index\\":%d,\\"passed\\":%t,\\"got\\":%s}\\n",
		index, string(gotJSON) == string(expJSON), gotJSON)`
    : `	encoded, _ := json.Marshal(got)
	fmt.Printf("{\\"index\\":%d,\\"passed\\":%t,\\"got\\":%s}\\n",
		index, reflect.DeepEqual(got, expected), encoded)`

  const normalise = sliceReturn
    ? `
func normalise(v ${GO_TYPE[sig.returns]}) []byte {
	out, _ := json.Marshal(v)
	if string(out) == "null" {
		return []byte("[]")
	}
	return out
}
`
    : ''

  return `package main

import (
	"encoding/json"
	"fmt"
	"reflect"
)

var _ = reflect.DeepEqual
${normalise}
func check(index int, fn func() ${GO_TYPE[sig.returns]}, expected ${GO_TYPE[sig.returns]}) {
	defer func() {
		if r := recover(); r != nil {
			out, _ := json.Marshal(fmt.Sprint(r))
			fmt.Printf("{\\"index\\":%d,\\"passed\\":false,\\"error\\":%s}\\n", index, out)
		}
	}()
	got := fn()
${compare}
}

func main() {
${cases}
}
`
}
