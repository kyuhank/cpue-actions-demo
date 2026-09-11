"""Run a versioned SQL extraction against the immutable toy database snapshot."""
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import subprocess
import time

started = time.perf_counter()

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"
OUT.mkdir(exist_ok=True)
source = ROOT / os.getenv("TOY_SOURCE_DATABASE", "data/toy-fishery.sqlite")
query = (ROOT / "pipeline/extract.sql").read_text()
with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as db:
    input_rows = db.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
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
def revision(folder, override):
    if os.getenv(override):
        return os.environ[override]
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=folder, text=True, stderr=subprocess.DEVNULL).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unversioned-local-copy"

commit = revision(ROOT, "TOY_CODE_COMMIT")
manifest = {
    "data_kind": "wholly synthetic; no confidential fishery data",
    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "query_sha256": hashlib.sha256(query.encode()).hexdigest(),
    "git_commit": commit,
    "source_repository": os.getenv("TOY_DATA_REPOSITORY", "kyuhank/cpue-actions-demo"),
    "source_git_commit": revision(source.parent.parent, "TOY_DATA_COMMIT"),
    "github_run_id": os.getenv("GITHUB_RUN_ID", "local"),
    "github_run_attempt": os.getenv("GITHUB_RUN_ATTEMPT", "1"),
    "python": platform.python_version(),
    "sqlite": sqlite3.sqlite_version,
    "container_image": os.getenv("TOY_CONTAINER_IMAGE", "none; native Python"),
    "runner_image": os.getenv("ImageVersion", "local"),
    "rows": len(rows), "first_year": min(r[1] for r in rows), "last_year": max(r[1] for r in rows),
    "extraction": {"input_rows": input_rows, "retained_rows": len(rows),
        "excluded_rows": input_rows - len(rows), "vessels": len({r[2] for r in rows}),
        "zero_catch_sets": sum(r[4] == 0 for r in rows), "total_hooks": sum(r[3] for r in rows),
        "total_catch_n": sum(r[4] for r in rows), "checks": "unique set IDs; positive effort; nonnegative catch; matching index and removal years"},
    "stage_compute_seconds": {"extract": time.perf_counter() - started},
    "choices": json.loads((ROOT / "pipeline/choices.json").read_text()),
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"EXTRACT complete: {len(rows)} synthetic sets, through {manifest['last_year']}; source {manifest['source_sha256'][:12]}")
