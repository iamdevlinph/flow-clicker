#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
CARGO = ROOT / "src-tauri/Cargo.toml"
LOCK = ROOT / "src-tauri/Cargo.lock"
VERSION = re.compile(r'(?m)^(version = ")(\d+\.\d+\.\d+)(")$')


def bumped(version, level):
    major, minor, patch = map(int, version.split("."))
    return {"major": f"{major + 1}.0.0", "minor": f"{major}.{minor + 1}.0", "patch": f"{major}.{minor}.{patch + 1}", "none": version}[level]


def head_version():
    return VERSION.search(subprocess.run(["git", "show", "HEAD:src-tauri/Cargo.toml"], cwd=ROOT, check=True, text=True, capture_output=True).stdout).group(2)


def package_version(text):
    match = re.search(r'(?ms)^\[\[package\]\]\nname = "flowclicker"\nversion = "(\d+\.\d+\.\d+)"', text)
    if not match:
        raise SystemExit("FlowClicker package entry missing from Cargo.lock")
    return match


def apply(level):
    if level not in {"major", "minor", "patch", "none"}:
        raise SystemExit("level must be major, minor, patch, or none")
    base = head_version()
    target = bumped(base, level)
    cargo = CARGO.read_text()
    lock = LOCK.read_text()
    current = VERSION.search(cargo).group(2)
    locked = package_version(lock).group(1)
    if current not in {base, target} or locked not in {base, target} or current != locked:
        raise SystemExit(f"unexpected existing version edit: Cargo.toml={current}, Cargo.lock={locked}, HEAD={base}")
    if level == "none":
        return base
    CARGO.write_text(VERSION.sub(rf'\g<1>{target}\g<3>', cargo, count=1))
    match = package_version(lock)
    LOCK.write_text(lock[:match.start(1)] + target + lock[match.end(1):])
    return target


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: bump_version.py <major|minor|patch|none>")
    print(apply(sys.argv[1]))
