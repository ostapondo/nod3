"""Reference implementations for every problem in the bank.
Runs each stored test case and reports any mismatch, so a wrong `expected`
can never ship.
"""
import json
import sys
from collections import Counter, deque

P = "/Users/ostapbelei/Desktop/alg/apps/server/src/data/problems.json"


def two_sum_sorted(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        s = nums[lo] + nums[hi]
        if s == target:
            return [lo, hi]
        if s < target:
            lo += 1
        else:
            hi -= 1
    return []






def num_islands(grid):
    if not grid or not grid[0]:
        return 0
    rows, cols = len(grid), len(grid[0])
    seen = [[False] * cols for _ in range(rows)]
    count = 0
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] != 1 or seen[r][c]:
                continue
            count += 1
            q = deque([(r, c)])
            seen[r][c] = True
            while q:
                cr, cc = q.popleft()
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = cr + dr, cc + dc
                    if 0 <= nr < rows and 0 <= nc < cols and not seen[nr][nc] and grid[nr][nc] == 1:
                        seen[nr][nc] = True
                        q.append((nr, nc))
    return count




def word_break(s, word_dict):
    words = set(word_dict)
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(i):
            if dp[j] and s[j:i] in words:
                dp[i] = True
                break
    return dp[n]


def min_window(s, t):
    if not s or not t or len(t) > len(s):
        return ""
    need = Counter(t)
    missing = len(t)
    best = (float("inf"), 0, 0)
    left = 0
    for right, ch in enumerate(s):
        if need[ch] > 0:
            missing -= 1
        need[ch] -= 1
        while missing == 0:
            if right - left + 1 < best[0]:
                best = (right - left + 1, left, right + 1)
            need[s[left]] += 1
            if need[s[left]] > 0:
                missing += 1
            left += 1
    return "" if best[0] == float("inf") else s[best[1]:best[2]]


def is_valid(s):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
        else:
            stack.append(ch)
    return not stack


def max_profit(prices):
    best = 0
    cheapest = None
    for price in prices:
        if cheapest is None or price < cheapest:
            cheapest = price
        elif price - cheapest > best:
            best = price - cheapest
    return best


REF = {
    "two_sum_sorted": two_sum_sorted,
    "is_valid": is_valid,
    "max_profit": max_profit,
    "num_islands": num_islands,
    "word_break": word_break,
    "min_window": min_window,
}


def norm(v):
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    return v


def main():
    problems = json.load(open(P))
    bad = 0
    for prob in problems:
        fn = REF.get(prob["entry"])
        if fn is None:
            print(f"!! no reference for {prob['entry']}")
            bad += 1
            continue
        for i, case in enumerate(prob["tests"]):
            import copy
            got = fn(*copy.deepcopy(case["args"]))
            if norm(got) != norm(case["expected"]):
                bad += 1
                print(f"MISMATCH {prob['id']} case#{i} args={case['args']!r}")
                print(f"   stored expected: {case['expected']!r}")
                print(f"   reference says : {got!r}")
    total = sum(len(p["tests"]) for p in problems)
    print(f"\n{len(problems)} problems, {total} test cases, {bad} mismatch(es)")
    return 1 if bad else 0


sys.exit(main())
