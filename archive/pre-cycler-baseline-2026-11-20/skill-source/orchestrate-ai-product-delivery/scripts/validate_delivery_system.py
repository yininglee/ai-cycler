#!/usr/bin/env python3
"""Validate a coordinated AI product delivery document system.

This checks document presence, cross-links, required concepts, ledger basics,
Markdown fences, unresolved placeholders, and JSONL evaluation-case integrity.
It does not claim that product, AI, legal, or production Gates have passed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote


@dataclass
class Finding:
    severity: str
    code: str
    path: str
    message: str


PLACEHOLDER_RE = re.compile(
    r"\[(?:PRODUCT_NAME|DATE|VERSION|SOURCE_DOCS|ROADMAP_FILE|RD_GUIDE_FILE|"
    r"STAGE|GATE|STATUS|YYYYMMDD|TITLE)\]|\b(?:TODO|TBD)\b"
)


def read_text(path: Path, findings: list[Finding]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        findings.append(Finding("ERROR", "READ_FAILED", str(path), str(exc)))
        return ""


def first_match(paths: Iterable[Path], predicate) -> Path | None:
    return next((path for path in paths if predicate(path.name.lower())), None)


def require_terms(
    path: Path,
    text: str,
    groups: dict[str, tuple[str, ...]],
    findings: list[Finding],
) -> None:
    lowered = text.lower()
    for label, alternatives in groups.items():
        if not any(term.lower() in lowered for term in alternatives):
            findings.append(
                Finding(
                    "ERROR",
                    "MISSING_CONCEPT",
                    str(path),
                    f"Missing required concept: {label} ({' / '.join(alternatives)})",
                )
            )


def check_markdown(path: Path, text: str, findings: list[Finding]) -> None:
    if text.count("```") % 2:
        findings.append(
            Finding("ERROR", "UNBALANCED_FENCE", str(path), "Unbalanced Markdown code fence")
        )
    placeholders = sorted(set(PLACEHOLDER_RE.findall(text)))
    if placeholders:
        findings.append(
            Finding(
                "ERROR",
                "UNRESOLVED_PLACEHOLDER",
                str(path),
                "Unresolved placeholders: " + ", ".join(placeholders),
            )
        )


def check_cross_link(
    source: Path, source_text: str, target: Path, findings: list[Finding]
) -> None:
    if target.name not in source_text and str(target.as_posix()) not in source_text:
        findings.append(
            Finding(
                "WARN",
                "MISSING_CROSS_LINK",
                str(source),
                f"Does not reference {target.name}",
            )
        )


def check_local_links(
    source: Path, source_text: str, root: Path, findings: list[Finding]
) -> None:
    for raw_target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", source_text):
        target = raw_target.strip().strip("<>").split("#", 1)[0]
        if not target or re.match(r"^(?:https?://|mailto:)", target, re.IGNORECASE):
            continue
        resolved = (source.parent / unquote(target)).resolve()
        try:
            resolved.relative_to(root)
        except ValueError:
            findings.append(
                Finding("WARN", "LINK_OUTSIDE_PROJECT", str(source), f"Link leaves project: {raw_target}")
            )
            continue
        if not resolved.exists():
            findings.append(
                Finding("ERROR", "BROKEN_LOCAL_LINK", str(source), f"Missing link target: {raw_target}")
            )


def check_jsonl(path: Path, findings: list[Finding]) -> None:
    case_ids: set[str] = set()
    total = 0
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        total += 1
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as exc:
            findings.append(
                Finding(
                    "ERROR",
                    "INVALID_JSONL",
                    str(path),
                    f"Line {line_number}: {exc.msg}",
                )
            )
            continue
        case_id = item.get("case_id")
        if not case_id:
            findings.append(
                Finding(
                    "ERROR",
                    "MISSING_CASE_ID",
                    str(path),
                    f"Line {line_number} has no case_id",
                )
            )
        elif case_id in case_ids:
            findings.append(
                Finding(
                    "ERROR",
                    "DUPLICATE_CASE_ID",
                    str(path),
                    f"Duplicate case_id: {case_id}",
                )
            )
        else:
            case_ids.add(case_id)
    if total == 0:
        findings.append(Finding("ERROR", "EMPTY_EVAL_SET", str(path), "No cases found"))


def duplicate_ids(path: Path, text: str, pattern: str, findings: list[Finding]) -> None:
    ids = re.findall(pattern, text, flags=re.MULTILINE)
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        findings.append(
            Finding(
                "ERROR",
                "DUPLICATE_LEDGER_ID",
                str(path),
                "Duplicate IDs: " + ", ".join(duplicates),
            )
        )


def validate(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    top_level_md = sorted(root.glob("*.md"))

    rd_guide = first_match(
        top_level_md,
        lambda name: "demo" in name and "agent" in name and "指南" in name,
    )
    roadmap = first_match(
        top_level_md,
        lambda name: "版本路线图" in name and "放行" in name,
    )

    required_ledger = {
        "ledger_index": root / "project-ledger" / "index.md",
        "ledger_readme": root / "project-ledger" / "README.md",
        "current_status": root / "project-ledger" / "current-status.md",
        "progress": root / "project-ledger" / "progress-ledger.md",
        "decisions": root / "project-ledger" / "decision-log.md",
    }

    if rd_guide is None:
        findings.append(
            Finding("ERROR", "MISSING_RD_GUIDE", str(root), "Demo/Agent R&D guide not found")
        )
    if roadmap is None:
        findings.append(
            Finding("ERROR", "MISSING_ROADMAP", str(root), "Release roadmap not found")
        )
    for label, path in required_ledger.items():
        if not path.is_file():
            findings.append(
                Finding("ERROR", "MISSING_LEDGER_FILE", str(path), f"Missing {label}")
            )

    texts: dict[Path, str] = {}
    coordinated = [path for path in [rd_guide, roadmap, *required_ledger.values()] if path and path.is_file()]
    for path in coordinated:
        text = read_text(path, findings)
        texts[path] = text
        check_markdown(path, text, findings)

    if rd_guide:
        require_terms(
            rd_guide,
            texts.get(rd_guide, ""),
            {
                "Agent architecture": ("Agent 架构", "Agent 结构", "Agent architecture"),
                "RAG decision": ("RAG",),
                "tool/function calling": ("Function Calling", "工具调用", "tool calling"),
                "Prompt": ("Prompt", "提示词"),
                "fallback": ("兜底", "降级", "fallback"),
                "evaluation": ("评测", "evaluation"),
                "benchmark": ("基准", "benchmark"),
            },
            findings,
        )

    if roadmap:
        require_terms(
            roadmap,
            texts.get(roadmap, ""),
            {
                "Demo": ("Demo",),
                "Alpha": ("Alpha",),
                "Beta": ("Beta",),
                "release candidate": ("Release Candidate", "MVP RC", "RC"),
                "GO/NO-GO": ("NO-GO", "NO GO"),
                "rollback": ("回滚", "rollback"),
                "continuous iteration": ("持续迭代", "持续优化", "v1.x", "证据驱动扩展", "continuous iteration"),
            },
            findings,
        )

    current = required_ledger["current_status"]
    if current.is_file():
        current_text = texts.get(current, "")
        gates = re.findall(r"^>\s*当前 Gate[：:]\s*(.+)$", current_text, re.MULTILINE)
        if len(gates) != 1:
            findings.append(
                Finding(
                    "ERROR",
                    "CURRENT_GATE_COUNT",
                    str(current),
                    f"Expected exactly one current Gate header, found {len(gates)}",
                )
            )
        if "下一工作项" not in current_text:
            findings.append(
                Finding("ERROR", "MISSING_NEXT_ITEM", str(current), "No next work item section")
            )
        if "版本矩阵" not in current_text:
            findings.append(
                Finding("WARN", "MISSING_VERSION_MATRIX", str(current), "No version matrix")
            )
        next_items = re.findall(r"^###\s+ITEM-[^\n]+$", current_text, re.MULTILINE)
        if len(next_items) != 1:
            findings.append(
                Finding(
                    "ERROR",
                    "NEXT_ITEM_COUNT",
                    str(current),
                    f"Expected exactly one ITEM heading, found {len(next_items)}",
                )
            )

    ledger_index = required_ledger["ledger_index"]
    if ledger_index.is_file():
        index_text = texts.get(ledger_index, "")
        require_terms(
            ledger_index,
            index_text,
            {
                "current status source": ("current-status.md",),
                "progress source": ("progress-ledger.md",),
                "decision source": ("decision-log.md",),
                "work-item reviews": ("reviews/ITEM-", "reviews/"),
                "benchmark source": ("eval/benchmark-report.md", "benchmark-report.md"),
            },
            findings,
        )
        check_local_links(ledger_index, index_text, root, findings)

    progress = required_ledger["progress"]
    if progress.is_file():
        progress_text = texts.get(progress, "")
        duplicate_ids(progress, progress_text, r"^##\s+(LOG-[0-9]{8}-[0-9]{3})", findings)
        entries = re.split(r"(?=^##\s+LOG-[0-9]{8}-[0-9]{3})", progress_text, flags=re.MULTILINE)
        latest_entry = next((entry for entry in reversed(entries) if re.match(r"^##\s+LOG-", entry)), "")
        if latest_entry:
            status_match = re.search(r"状态[：:]\s*`?([A-Z_/-]+)`?", latest_entry)
            allowed_statuses = {
                "PROPOSED",
                "READY",
                "IN_PROGRESS",
                "READY_FOR_PREVIEW",
                "CHANGES_REQUESTED",
                "ACCEPTED",
                "BLOCKED",
                "CANCELLED",
            }
            if not status_match:
                findings.append(
                    Finding("WARN", "LATEST_LOG_STATUS_MISSING", str(progress), "Latest LOG has no status")
                )
            elif status_match.group(1) not in allowed_statuses:
                findings.append(
                    Finding(
                        "ERROR",
                        "LATEST_LOG_STATUS_INVALID",
                        str(progress),
                        f"Latest LOG uses unsupported status: {status_match.group(1)}",
                    )
                )

    decisions = required_ledger["decisions"]
    if decisions.is_file():
        duplicate_ids(decisions, texts.get(decisions, ""), r"^##\s+(DEC-[0-9]{3})", findings)

    if rd_guide and roadmap:
        check_cross_link(rd_guide, texts.get(rd_guide, ""), roadmap, findings)
        check_cross_link(roadmap, texts.get(roadmap, ""), rd_guide, findings)
    if rd_guide and current.is_file() and "project-ledger/current-status.md" not in texts.get(rd_guide, ""):
        findings.append(
            Finding("WARN", "MISSING_LEDGER_LINK", str(rd_guide), "No current-status link")
        )
    if roadmap and current.is_file() and "project-ledger/current-status.md" not in texts.get(roadmap, ""):
        findings.append(
            Finding("WARN", "MISSING_LEDGER_LINK", str(roadmap), "No current-status link")
        )

    eval_dir = root / "eval"
    if eval_dir.is_dir():
        jsonl_files = sorted(eval_dir.glob("*.jsonl"))
        if not jsonl_files:
            findings.append(
                Finding("WARN", "MISSING_EVAL_JSONL", str(eval_dir), "No JSONL evaluation set")
            )
        for path in jsonl_files:
            try:
                check_jsonl(path, findings)
            except (OSError, UnicodeError) as exc:
                findings.append(Finding("ERROR", "READ_FAILED", str(path), str(exc)))
        if not any("benchmark" in path.name.lower() for path in eval_dir.glob("*.md")):
            findings.append(
                Finding("WARN", "MISSING_BENCHMARK_REPORT", str(eval_dir), "No benchmark report")
            )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_root", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures")
    args = parser.parse_args()

    root = args.project_root.expanduser().resolve()
    if not root.is_dir():
        print(f"Project root is not a directory: {root}", file=sys.stderr)
        return 2

    findings = validate(root)
    errors = sum(item.severity == "ERROR" for item in findings)
    warnings = sum(item.severity == "WARN" for item in findings)

    if args.as_json:
        print(json.dumps({"errors": errors, "warnings": warnings, "findings": [asdict(item) for item in findings]}, ensure_ascii=False, indent=2))
    else:
        for item in findings:
            print(f"[{item.severity}] {item.code} {item.path}: {item.message}")
        print(f"Validation complete: {errors} error(s), {warnings} warning(s)")

    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
