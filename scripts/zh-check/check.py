#!/usr/bin/env python3
"""
zh-TW forbidden-term scanner.

Parses forbidden-terms.md (same directory) and scans content files for
Mainland-Chinese wording and simplified characters. Used as a hard gate by
the content-translate agent and /social-content before output is finalized.

Exit codes:
  0 = clean (warnings allowed)
  1 = errors found (HARD-BAN terms or simplified characters)
  2 = usage / dictionary error
"""

import argparse
import re
import sys
from pathlib import Path

SEVERITIES = {"HARD-BAN", "PREFER-TW", "CONTEXT", "SOCIAL-ONLY", "ALLOW"}
ERROR_SEVERITIES = {"HARD-BAN"}

# Unambiguously simplified characters (never valid in Traditional text).
# A partial set is enough: any accidental simplified output will contain
# several high-frequency members.
SIMPLIFIED_CHARS = set(
    "这个们来时为会说对与学应点见现网头还进过门问间电号处张记认从众东车长"
    "写让边读语术页风飞马鱼单双变体万亿价优传关兴军农决况冻净够头夹夺奋妈妇"
    "孙实审对寻导尔层岁岛币师带帮广库张弹归当录彻忆态怀总恶惊惯战户扫执扩护"
    "报担拟拥挤损换摄摆数断无旧显晓暂机杀杂权条极构枪标栏树样桥检楼汇汉汤"
    "沟泽洁浅测济浏涛润涨湾满滤滨灭灯灵炼热爱牵犹独猎环玛画异疗监盖盘确码礼"
    "祸离种积称窝竞笔筛简类红级纪纯纲纳纸纹纺线练组细织终经结绍给络统继绩维"
    "绿缓编缩罗罚罢义习联聪胁脑脸舰艰节苏药营蓝虑虽蚂补装观规视览觉誉计订讨"
    "训议讯讲许论设访证评识诉词译试话该详误请诸课谁调谈谢贝负贡财责败货质购"
    "贵费资赛赞赢轨转轮软轻载较辑输辞达迁运远违连迟适选逻遗邮邻释针钟钱铁银"
    "错锁锋锦键镜闪闭闲闻阅队阶际陆陈险隐难雾顶项顺须顾顿预领频题颜饭饮馆驱"
    "驶验骑鸟鸡鸣鲜麦齐龙龄"
)


def load_dictionary(dict_path: Path):
    """Parse markdown table rows into scan entries."""
    entries = []          # (terms, replacement, severity, note)
    allow_terms = []      # ALLOW rows — used as match exceptions
    row_re = re.compile(r"^\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]*)\|?\s*$")
    for line in dict_path.read_text(encoding="utf-8").splitlines():
        m = row_re.match(line)
        if not m:
            continue
        raw_terms, replacement, severity, note = (c.strip() for c in m.groups())
        if severity not in SEVERITIES:
            continue
        terms = [t.strip() for t in re.split(r"[／/]", raw_terms) if t.strip()]
        # Only scan CJK terms; Latin entries (e.g., YYDS) matched case-insensitively.
        if severity == "ALLOW":
            allow_terms.extend(terms)
            continue
        entries.append((terms, replacement, severity, note))
    if not entries:
        print(f"dictionary parse error: no entries found in {dict_path}", file=sys.stderr)
        sys.exit(2)
    # Match exceptions: any replacement or allowlisted string that CONTAINS a
    # banned term must not trigger it (e.g. 算法 inside 演算法).
    exception_strings = set(allow_terms)
    for terms, replacement, _, _ in entries:
        for part in re.split(r"[／/，,（(]", replacement):
            part = part.strip()
            if part:
                exception_strings.add(part)
    return entries, exception_strings


def strip_non_prose(text: str) -> str:
    """Blank out fenced code, inline code, and HTML comments, preserving offsets."""

    def blank(m):
        return re.sub(r"[^\n]", " ", m.group(0))

    text = re.sub(r"```.*?(```|\Z)", blank, text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", blank, text)
    text = re.sub(r"<!--.*?(-->|\Z)", blank, text, flags=re.S)
    return text


def excepted(text: str, pos: int, term: str, exceptions) -> bool:
    """True if the match at pos is part of a longer legitimate string."""
    for s in exceptions:
        if term == s or term not in s:
            continue
        k = s.find(term)
        while k != -1:
            start = pos - k
            if start >= 0 and text[start : start + len(s)] == s:
                return True
            k = s.find(term, k + 1)
    return False


def scan_file(path: Path, entries, exceptions, channel: str):
    raw = path.read_text(encoding="utf-8")
    text = strip_non_prose(raw)
    lines = text.splitlines(keepends=True)
    findings = []  # (lineno, severity, term, replacement)

    offset = 0
    for lineno, line in enumerate(lines, start=1):
        for terms, replacement, severity, _ in entries:
            if severity == "SOCIAL-ONLY" and channel == "social":
                continue
            for term in terms:
                if re.search(r"[a-zA-Z]", term):
                    hit_iter = re.finditer(re.escape(term), line, re.IGNORECASE)
                else:
                    hit_iter = re.finditer(re.escape(term), line)
                for m in hit_iter:
                    if excepted(text, offset + m.start(), term, exceptions):
                        continue
                    findings.append((lineno, severity, term, replacement))
        for ch in line:
            if ch in SIMPLIFIED_CHARS:
                findings.append((lineno, "SIMPLIFIED", ch, "使用繁體字"))
        offset += len(line)
    return findings


def scan_patterns(path: Path, text: str):
    """Scan for structural AI writing patterns. Returns (lineno, name, suggestion)."""
    findings = []
    lines = text.splitlines()

    # S1: 首先/其次/最後 enumeration within proximity
    full = text
    for m in re.finditer(r"首先.{0,500}?其次.{0,500}?最後", full, re.S):
        lineno = full[: m.start()].count("\n") + 1
        findings.append((lineno, "首先其次最後 enumeration", "use natural transitions"))

    # S2: 不僅是X更是Y false elevation
    for i, line in enumerate(lines, 1):
        if re.search(r"不僅[是為].{2,40}[，,].*更[是為]", line):
            findings.append((i, "不僅X更是Y false elevation", "rewrite as direct statement"))

    # C1: Significance inflation phrases
    inflation = ["深遠意義", "重要時刻", "彰顯了", "標誌著", "重要里程碑", "舉足輕重"]
    for i, line in enumerate(lines, 1):
        for phrase in inflation:
            if phrase in line:
                findings.append((i, f"significance inflation: {phrase}", "delete or state concrete fact"))
                break

    # R1: Paragraph-ending summarizers
    summarizers = ["總而言之", "綜上所述", "總結來說", "整體而言", "由此可見"]
    for i, line in enumerate(lines, 1):
        for phrase in summarizers:
            if phrase in line:
                findings.append((i, f"summarizer phrase: {phrase}", "delete — stop at last concrete sentence"))
                break

    # S5: Adverb stacking (2+ consecutive intensifiers within 10 chars)
    adverbs = "非常|極其|十分|相���|格外|尤其"
    for i, line in enumerate(lines, 1):
        if re.search(rf"({adverbs}).{{0,6}}({adverbs})", line):
            findings.append((i, "adverb stacking", "keep one or delete all"))

    # R4: Connector overuse (count across full text)
    connectors = {"然而": 0, "因此": 0, "此外": 0}
    for i, line in enumerate(lines, 1):
        for c in connectors:
            connectors[c] += line.count(c)
    total_connectors = sum(connectors.values())
    if total_connectors > 3:
        findings.append((0, f"connector overuse ({total_connectors} total)", "max 1 each; use 不過/所以/另外"))

    # S4: Formulaic openings
    openers = [r"^隨著.{2,20}的發展", r"^在這個.{2,20}的時代", r"^近年來"]
    for i, line in enumerate(lines, 1):
        for pat in openers:
            if re.search(pat, line.strip()):
                findings.append((i, "formulaic opening", "start with the specific fact"))
                break

    return findings


def main():
    ap = argparse.ArgumentParser(description="Scan zh-TW content for Mainland wording.")
    ap.add_argument("files", nargs="+", help="content file(s) to scan")
    ap.add_argument("--dict", default=str(Path(__file__).parent / "forbidden-terms.md"))
    ap.add_argument("--channel", choices=["article", "social"], default="article")
    ap.add_argument("--patterns", action="store_true",
                    help="Also scan for AI writing patterns (warn-only, never errors)")
    args = ap.parse_args()

    dict_path = Path(args.dict).expanduser()
    if not dict_path.exists():
        print(f"dictionary not found: {dict_path}", file=sys.stderr)
        sys.exit(2)
    entries, exceptions = load_dictionary(dict_path)

    errors = warnings = patterns = 0
    for f in args.files:
        path = Path(f).expanduser()
        if not path.exists():
            print(f"file not found: {path}", file=sys.stderr)
            sys.exit(2)
        for lineno, severity, term, replacement in scan_file(path, entries, exceptions, args.channel):
            is_error = severity in ERROR_SEVERITIES or severity == "SIMPLIFIED"
            errors += is_error
            warnings += not is_error
            print(f"{path}:{lineno} [{severity}] {term} → {replacement}")

        if args.patterns:
            raw = path.read_text(encoding="utf-8")
            text = strip_non_prose(raw)
            for lineno, name, suggestion in scan_patterns(path, text):
                patterns += 1
                print(f"{path}:{lineno} [PATTERN] {name} → {suggestion}")

    summary = f"--- {errors} error(s), {warnings} warning(s)"
    if args.patterns:
        summary += f", {patterns} pattern(s)"
    print(summary)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
