"""Runs a candidate solution against test cases and prints a JSON verdict.

Invoked as: python3 run_python.py <solution.py> <entry_fn> <tests.json>
Everything stays local; this is your own code on your own machine.
"""
import json
import sys
import traceback
import signal

sys.setrecursionlimit(30000)

PER_CASE_TIMEOUT_S = 5


class Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise Timeout()


def normalise(value):
    """Tuples and lists compare equal; sets are order-insensitive."""
    if isinstance(value, tuple):
        return [normalise(v) for v in value]
    if isinstance(value, list):
        return [normalise(v) for v in value]
    if isinstance(value, set):
        return sorted(normalise(v) for v in value)
    if isinstance(value, dict):
        return {k: normalise(v) for k, v in value.items()}
    return value


def resolve_entry(namespace, entry):
    """Accept snake_case or camelCase — the name should not be the obstacle."""
    head, *rest = entry.split("_")
    camel = head + "".join(w.title() for w in rest)
    for candidate in (entry, camel, camel[0].upper() + camel[1:]):
        fn = namespace.get(candidate)
        if callable(fn):
            return fn
    return None


def main():
    solution_path, entry, tests_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(tests_path) as fh:
        tests = json.load(fh)

    namespace = {"__name__": "__solution__"}
    try:
        with open(solution_path) as fh:
            exec(compile(fh.read(), solution_path, "exec"), namespace)
    except Exception:
        print(json.dumps({
            "error": "compile",
            "message": traceback.format_exc(limit=3),
            "results": [],
        }))
        return

    fn = resolve_entry(namespace, entry)
    if not callable(fn):
        print(json.dumps({
            "error": "entry",
            "message": f"No function named `{entry}` found at top level.",
            "results": [],
        }))
        return

    signal.signal(signal.SIGALRM, _alarm)
    results = []
    for i, case in enumerate(tests):
        args = case["args"]
        expected = normalise(case["expected"])
        row = {"index": i, "hidden": case.get("hidden", False), "note": case.get("note")}
        signal.setitimer(signal.ITIMER_REAL, PER_CASE_TIMEOUT_S)
        try:
            got = normalise(fn(*[normalise(a) for a in args]))
            row["passed"] = got == expected
            row["got"] = got
            row["expected"] = expected
            row["args"] = args
        except Timeout:
            row["passed"] = False
            row["error"] = f"timed out after {PER_CASE_TIMEOUT_S}s"
            row["args"] = args
            row["expected"] = expected
        except Exception as exc:
            row["passed"] = False
            row["error"] = f"{type(exc).__name__}: {exc}"
            row["args"] = args
            row["expected"] = expected
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        results.append(row)

    print(json.dumps({"error": None, "results": results}))


if __name__ == "__main__":
    main()
