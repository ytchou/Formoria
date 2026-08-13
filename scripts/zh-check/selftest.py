#!/usr/bin/env python3
"""Smoke test for check.py: dirty fixture must fail, clean fixture must pass."""

import subprocess
import sys
from pathlib import Path

DIR = Path(__file__).parent
CHECK = DIR / "check.py"
DICT = DIR / "forbidden-terms.md"

passed = failed = 0


def run(label, args, expect_exit):
    global passed, failed
    r = subprocess.run([sys.executable, str(CHECK)] + args, capture_output=True, text=True)
    if r.returncode == expect_exit:
        print(f"PASS: {label}")
        passed += 1
    else:
        print(f"FAIL: {label} (expected exit {expect_exit}, got {r.returncode})")
        print(f"  stdout: {r.stdout.strip()}")
        failed += 1


run("dirty fixture exits 1", [str(DIR / "test_dirty.md")], 1)
run("clean fixture exits 0", [str(DIR / "test_clean.md")], 0)

# Dictionary parse: must find ≥100 entries
sys.path.insert(0, str(DIR))
from check import load_dictionary  # noqa: E402

entries, _ = load_dictionary(DICT)
if len(entries) >= 100:
    print(f"PASS: dictionary has {len(entries)} entries (≥100)")
    passed += 1
else:
    print(f"FAIL: dictionary has only {len(entries)} entries (expected ≥100)")
    failed += 1

# 演算法 exception: 算法 inside 演算法 must not trigger on clean file
r = subprocess.run(
    [sys.executable, str(CHECK), str(DIR / "test_clean.md")],
    capture_output=True, text=True,
)
if "算法" not in r.stdout:
    print("PASS: 演算法 exception works")
    passed += 1
else:
    print("FAIL: 演算法 exception not working — scanner flagged 算法 inside 演算法")
    failed += 1

# 拮据 must not be flagged (据 removed from SIMPLIFIED_CHARS)
if "据" not in r.stdout:
    print("PASS: 拮据 not falsely flagged")
    passed += 1
else:
    print("FAIL: 拮据 falsely flagged as simplified")
    failed += 1

# --- Pattern heuristic tests ---

# Write a temp file with AI patterns
pattern_fixture = DIR / "test_patterns_tmp.md"
pattern_fixture.write_text(
    "隨著人工智慧的發展，我們正在經歷改變。\n\n"
    "首先，它很重要。其次，很有用。最後，很方便。\n\n"
    "這不僅是工具，更是一種理念。\n\n"
    "這具有深遠意義。\n\n"
    "然而要注意。因此很重要。此外需改進。此外要轉型。\n\n"
    "綜上所述，前景光明。\n",
    encoding="utf-8",
)

# --patterns flag must detect patterns but still exit 0 (no forbidden terms)
r = subprocess.run(
    [sys.executable, str(CHECK), "--patterns", str(pattern_fixture)],
    capture_output=True, text=True,
)
if r.returncode == 0 and "[PATTERN]" in r.stdout:
    print("PASS: --patterns detects AI patterns, exits 0")
    passed += 1
else:
    print(f"FAIL: --patterns (exit={r.returncode}, has PATTERN={('[PATTERN]' in r.stdout)})")
    print(f"  stdout: {r.stdout.strip()}")
    failed += 1

# Specific heuristics check
expected_patterns = ["首先其次最後", "不僅X更是Y", "significance inflation", "summarizer", "connector overuse", "formulaic opening"]
detected = sum(1 for p in expected_patterns if p in r.stdout)
if detected >= 5:
    print(f"PASS: {detected}/6 pattern heuristics fired")
    passed += 1
else:
    print(f"FAIL: only {detected}/6 pattern heuristics fired")
    print(f"  stdout: {r.stdout.strip()}")
    failed += 1

# Without --patterns, no [PATTERN] output
r_no_flag = subprocess.run(
    [sys.executable, str(CHECK), str(pattern_fixture)],
    capture_output=True, text=True,
)
if "[PATTERN]" not in r_no_flag.stdout:
    print("PASS: without --patterns flag, no pattern output")
    passed += 1
else:
    print("FAIL: patterns leaked without --patterns flag")
    failed += 1

# Clean up temp file
pattern_fixture.unlink(missing_ok=True)

print(f"--- {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
