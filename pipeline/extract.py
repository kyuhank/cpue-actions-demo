"""Run a versioned SQL extraction against the immutable toy database snapshot."""
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"
OUT.mkdir(exist_ok=True)
source = ROOT / "data/toy-fishery.sqlite"
query = (ROOT / "pipeline/extract.sql").read_text()
with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as db:
    rows = db.execute(query).fetchall()
    catches = db.execute("SELECT year, catch_t FROM removals ORDER BY year").fetchall()
if not rows or len({r[0] for r in rows}) != len(rows):
    raise SystemExit("Extraction failed: no rows or duplicated set identifiers")
if any(r[3] <= 0 or r[4] < 0 for r in rows):
    raise SystemExit("Extraction failed: invalid effort or catch")
if {r[1] for r in rows} != {r[0] for r in catches}:
    raise SystemExit("Extraction failed: CPUE and catch years differ")
for name, header, values in [
    ("sets.csv", ["set_id", "year", "vessel", "hooks", "catch_n"], rows),
    ("catch.csv", ["year", "catch_t"], catches),
]:
    with (OUT / name).open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(values)
try:
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
except subprocess.CalledProcessError:
    commit = "local-uncommitted"
manifest = {
    "data_kind": "wholly synthetic; no confidential fishery data",
    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "query_sha256": hashlib.sha256(query.encode()).hexdigest(),
    "git_commit": commit,
    "github_run_id": os.getenv("GITHUB_RUN_ID", "local"),
    "github_run_attempt": os.getenv("GITHUB_RUN_ATTEMPT", "1"),
    "python": platform.python_version(),
    "sqlite": sqlite3.sqlite_version,
    "runner_image": os.getenv("ImageVersion", "local"),
    "rows": len(rows), "first_year": min(r[1] for r in rows), "last_year": max(r[1] for r in rows),
    "choices": json.loads((ROOT / "pipeline/choices.json").read_text()),
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"EXTRACT complete: {len(rows)} synthetic sets, through {manifest['last_year']}; source {manifest['source_sha256'][:12]}")

