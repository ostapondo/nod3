import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getProblem } from './problems.js'
import { detectToolchains } from './toolchain.js'
import { runTests, starterCode, type Language } from './runner.js'

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nod3-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Correct solutions for one array problem and one string problem, in every
 * language. Between them they exercise every type in the signature vocabulary
 * that the generated harnesses have to marshal.
 */
const SOLUTIONS: Record<Language, { twoSum: string; wordBreak: string }> = {
  python: {
    twoSum: `def two_sum_sorted(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        s = nums[lo] + nums[hi]
        if s == target: return [lo, hi]
        if s < target: lo += 1
        else: hi -= 1
    return []`,
    wordBreak: `def word_break(s, word_dict):
    words = set(word_dict)
    dp = [True] + [False] * len(s)
    for i in range(1, len(s) + 1):
        dp[i] = any(dp[j] and s[j:i] in words for j in range(i))
    return dp[len(s)]`,
  },
  javascript: {
    twoSum: `function two_sum_sorted(nums, target) {
  let lo = 0, hi = nums.length - 1
  while (lo < hi) {
    const s = nums[lo] + nums[hi]
    if (s === target) return [lo, hi]
    if (s < target) lo++; else hi--
  }
  return []
}`,
    wordBreak: `function word_break(s, wordDict) {
  const words = new Set(wordDict)
  const dp = new Array(s.length + 1).fill(false)
  dp[0] = true
  for (let i = 1; i <= s.length; i++)
    for (let j = 0; j < i; j++)
      if (dp[j] && words.has(s.slice(j, i))) { dp[i] = true; break }
  return dp[s.length]
}`,
  },
  typescript: {
    twoSum: `function two_sum_sorted(nums: number[], target: number): number[] {
  let lo = 0
  let hi = nums.length - 1
  while (lo < hi) {
    const s: number = nums[lo] + nums[hi]
    if (s === target) return [lo, hi]
    if (s < target) lo++
    else hi--
  }
  return []
}`,
    wordBreak: `function word_break(s: string, wordDict: string[]): boolean {
  const words = new Set<string>(wordDict)
  const dp: boolean[] = new Array(s.length + 1).fill(false)
  dp[0] = true
  for (let i = 1; i <= s.length; i++)
    for (let j = 0; j < i; j++)
      if (dp[j] && words.has(s.slice(j, i))) { dp[i] = true; break }
  return dp[s.length]
}`,
  },
  java: {
    twoSum: `import java.util.*;

class Solution {
    public int[] twoSumSorted(int[] nums, int target) {
        int lo = 0, hi = nums.length - 1;
        while (lo < hi) {
            int s = nums[lo] + nums[hi];
            if (s == target) return new int[]{lo, hi};
            if (s < target) lo++; else hi--;
        }
        return new int[]{};
    }
}`,
    wordBreak: `import java.util.*;

class Solution {
    public boolean wordBreak(String s, String[] wordDict) {
        Set<String> words = new HashSet<>(Arrays.asList(wordDict));
        boolean[] dp = new boolean[s.length() + 1];
        dp[0] = true;
        for (int i = 1; i <= s.length(); i++)
            for (int j = 0; j < i; j++)
                if (dp[j] && words.contains(s.substring(j, i))) { dp[i] = true; break; }
        return dp[s.length()];
    }
}`,
  },
  cpp: {
    twoSum: `vector<int> twoSumSorted(vector<int> nums, int target) {
    int lo = 0, hi = (int)nums.size() - 1;
    while (lo < hi) {
        int s = nums[lo] + nums[hi];
        if (s == target) return {lo, hi};
        if (s < target) lo++; else hi--;
    }
    return {};
}`,
    wordBreak: `bool wordBreak(string s, vector<string> wordDict) {
    unordered_set<string> words(wordDict.begin(), wordDict.end());
    vector<bool> dp(s.size() + 1, false);
    dp[0] = true;
    for (size_t i = 1; i <= s.size(); i++)
        for (size_t j = 0; j < i; j++)
            if (dp[j] && words.count(s.substr(j, i - j))) { dp[i] = true; break; }
    return dp[s.size()];
}`,
  },
  go: {
    twoSum: `func twoSumSorted(nums []int, target int) []int {
	lo, hi := 0, len(nums)-1
	for lo < hi {
		s := nums[lo] + nums[hi]
		if s == target {
			return []int{lo, hi}
		}
		if s < target {
			lo++
		} else {
			hi--
		}
	}
	return []int{}
}`,
    wordBreak: `func wordBreak(s string, wordDict []string) bool {
	words := map[string]bool{}
	for _, w := range wordDict {
		words[w] = true
	}
	dp := make([]bool, len(s)+1)
	dp[0] = true
	for i := 1; i <= len(s); i++ {
		for j := 0; j < i; j++ {
			if dp[j] && words[s[j:i]] {
				dp[i] = true
				break
			}
		}
	}
	return dp[len(s)]
}`,
  },
}

const LANGUAGES = Object.keys(SOLUTIONS) as Language[]

for (const language of LANGUAGES) {
  test(`${language}: a correct solution passes every case`, async (t) => {
    const chains = await detectToolchains()
    if (!chains[language]?.available) {
      t.skip(`${language} toolchain not installed on this machine`)
      return
    }

    for (const [problemId, source] of [
      ['two-sum-sorted', SOLUTIONS[language].twoSum],
      ['word-break', SOLUTIONS[language].wordBreak],
    ] as const) {
      const problem = (await getProblem(problemId))!
      const result = await inTemp((dir) => runTests(source, problem, language, dir))
      assert.equal(result.error, null, `${problemId}: ${result.message ?? ''}`)
      assert.equal(
        result.passed,
        result.total,
        `${problemId}: ${result.passed}/${result.total}\n` +
          result.results
            .filter((r) => !r.passed)
            .map(
              (r) =>
                `  args=${JSON.stringify(r.args)} got=${JSON.stringify(r.got)} err=${r.error ?? ''}`,
            )
            .join('\n'),
      )
    }
  })

  test(`${language}: a wrong solution is reported as failing, not as an error`, async (t) => {
    const chains = await detectToolchains()
    if (!chains[language]?.available) {
      t.skip(`${language} toolchain not installed`)
      return
    }
    const problem = (await getProblem('two-sum-sorted'))!
    const wrong: Record<Language, string> = {
      python: 'def two_sum_sorted(nums, target):\n    return [0, 0]',
      javascript: 'function two_sum_sorted(nums, target) { return [0, 0] }',
      typescript:
        'function two_sum_sorted(nums: number[], target: number): number[] { return [0, 0] }',
      java: 'class Solution {\n  public int[] twoSumSorted(int[] nums, int target) { return new int[]{0, 0}; }\n}',
      cpp: 'vector<int> twoSumSorted(vector<int> nums, int target) { return {0, 0}; }',
      go: 'func twoSumSorted(nums []int, target int) []int {\n\treturn []int{0, 0}\n}',
    }
    const result = await inTemp((dir) => runTests(wrong[language], problem, language, dir))
    assert.equal(result.error, null, `expected a clean run, got ${result.error}: ${result.message}`)
    assert.ok(result.passed < result.total, 'a wrong answer must not pass everything')
    assert.ok(result.results.length === result.total, 'every case should be reported')
  })

  test(`${language}: the generated starter compiles as-is or fails cleanly`, async (t) => {
    const chains = await detectToolchains()
    if (!chains[language]?.available) {
      t.skip(`${language} toolchain not installed`)
      return
    }
    const problem = (await getProblem('two-sum-sorted'))!
    const starter = starterCode(problem, language)
    assert.ok(starter.length > 0, 'a starter must exist for every language')

    // An empty stub should never look like a pass, and should never take down
    // the runner with an unhandled crash.
    const result = await inTemp((dir) => runTests(starter, problem, language, dir))
    assert.notEqual(result.passed, result.total, 'an empty stub must not pass')
    if (result.error) {
      assert.ok(
        ['compile', 'crash', 'entry'].includes(result.error),
        `unexpected error kind: ${result.error}`,
      )
      assert.ok((result.message ?? '').length > 0, 'a failure must explain itself')
    }
  })
}

test('typescript: enum is rejected with an explanation, not a Node stack trace', async () => {
  const problem = (await getProblem('two-sum-sorted'))!
  const source = `enum Direction { Left, Right }
function two_sum_sorted(nums: number[], target: number): number[] { return [0, 1] }`

  const result = await inTemp((dir) => runTests(source, problem, 'typescript', dir))

  assert.equal(result.error, 'compile')
  assert.match(result.message ?? '', /enum/i)
  assert.match(result.message ?? '', /erases types/i, 'the message should say why, not just what')
})

test('typescript: type annotations do not leak into the answer', async () => {
  // Generic calls like `Map<string, string>` and `Array<string>` must be erased
  // rather than parsed as comparisons — the classic way type stripping breaks.
  const problem = (await getProblem('valid-parentheses'))!
  const source = `function is_valid(s: string): boolean {
  const pairs = new Map<string, string>([
    [')', '('],
    [']', '['],
    ['}', '{'],
  ])
  const stack: Array<string> = []
  for (const ch of s) {
    const opener: string | undefined = pairs.get(ch)
    if (opener !== undefined) {
      if (stack.pop() !== opener) return false
    } else {
      stack.push(ch)
    }
  }
  return stack.length === 0
}`
  const result = await inTemp((dir) => runTests(source, problem, 'typescript', dir))
  assert.equal(result.error, null, result.message ?? '')
  assert.equal(result.passed, result.total)
})
