#!/usr/bin/env python3
"""Rewrites problems.json in a shape that stays readable when hand-edited.

A plain json.dumps(indent=2) explodes every test case over a dozen lines, which
buries the thing you actually read: args in, expected out. This keeps the prose
fields expanded and collapses the data onto single lines.
"""
import json
import pathlib
import sys

PATH = pathlib.Path(__file__).resolve().parent.parent / "apps/server/src/data/problems.json"

# Values under these keys are collapsed onto one line wherever they appear.
INLINE_KEYS = {"tags", "args", "expected", "params", "signature", "optimal", "starter"}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))


def render(value, indent, key=None):
    pad = "  " * indent
    if key in INLINE_KEYS and key != "starter":
        return compact(value)

    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = "  " * (indent + 1)
        lines = [
            f"{inner}{json.dumps(k, ensure_ascii=False)}: {render(v, indent + 1, k)}"
            for k, v in value.items()
        ]
        return "{\n" + ",\n".join(lines) + "\n" + pad + "}"

    if isinstance(value, list):
        if not value:
            return "[]"
        # A list of test-case objects: one object per line.
        if all(isinstance(v, dict) for v in value):
            inner = "  " * (indent + 1)
            if key == "tests":
                return (
                    "[\n"
                    + ",\n".join(inner + compact(v) for v in value)
                    + "\n"
                    + pad
                    + "]"
                )
            return (
                "[\n"
                + ",\n".join(inner + render(v, indent + 1) for v in value)
                + "\n"
                + pad
                + "]"
            )
        inner = "  " * (indent + 1)
        return "[\n" + ",\n".join(inner + compact(v) for v in value) + "\n" + pad + "]"

    return compact(value)


def main():
    problems = json.loads(PATH.read_text())
    body = ",\n".join("  " + render(p, 1) for p in problems)
    text = "[\n" + body + "\n]\n"

    # Never write something that cannot be read back identically.
    assert json.loads(text) == problems, "formatter changed the data"

    if "--check" in sys.argv:
        if PATH.read_text() != text:
            print("problems.json is not in canonical form; run: python3 scripts/format-problems.py")
            return 1
        print("problems.json formatting ok")
        return 0

    PATH.write_text(text)
    print(f"formatted {len(problems)} problems")
    return 0


sys.exit(main())
