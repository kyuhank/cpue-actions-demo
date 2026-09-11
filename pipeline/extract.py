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
import shutil

started = time.perf_counter()

ROOT = Path(__file__).resolve().parents[1]
OUT = Path.cwd() / "outputs"
OUT.mkdir(exist_ok=True)
source = ROOT / os.getenv("TOY_SOURCE_DATABASE", "data/toy-fishery.sqlite")
queries = {name: (ROOT / 'pipeline' / name).read_text() for name in ('extract.sql', 'extract-catch.sql')}
query = queries['extract.sql']
with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as db:
    input_rows = db.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
    rows = db.execute(query).fetchall()
    catches = db.execute(queries['extract-catch.sql']).fetchall()
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
for name, sql in queries.items():
    (OUT / name).write_text(sql)
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
    "execution_mode": os.getenv("TOY_EXECUTION_MODE", "independent_jobs"),
    "physical_github_job": os.getenv("TOY_GITHUB_JOB", "per-stage jobs"),
    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "query_sha256": hashlib.sha256(query.encode()).hexdigest(),
    "extraction_queries": {name: hashlib.sha256(sql.encode()).hexdigest() for name, sql in queries.items()},
    "code_repository": "kyuhank/cpue-actions-demo",
    "git_commit": commit,
    "source_repository": "Supabase synthetic database" if os.getenv("TOY_SOURCE_PROVIDER") == "supabase" else os.getenv("TOY_DATA_REPOSITORY", "kyuhank/cpue-actions-demo"),
    "source_provider": os.getenv("TOY_SOURCE_PROVIDER", "github"),
    "source_version": os.getenv("TOY_SOURCE_VERSION", ""),
    "source_git_commit": None if os.getenv("TOY_SOURCE_PROVIDER") == "supabase" else revision(source.parent.parent, "TOY_DATA_COMMIT"),
    "github_run_id": os.getenv("GITHUB_RUN_ID", "local"),
    "github_run_attempt": os.getenv("GITHUB_RUN_ATTEMPT", "1"),
    "python": platform.python_version(),
    "sqlite": sqlite3.sqlite_version,
    "container_image": os.getenv("TOY_CONTAINER_IMAGE", "none; native Python"),
    "runner_image": os.getenv("ImageVersion", "local"),
    "rows": len(rows), "first_year": min(r[1] for r in rows), "last_year": max(r[1] for r in rows),
    "extraction_outputs": {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in ('sets.csv', 'catch.csv', *queries)},
    "extraction": {"input_rows": input_rows, "retained_rows": len(rows),
        "excluded_rows": input_rows - len(rows), "vessels": len({r[2] for r in rows}),
        "zero_catch_sets": sum(r[4] == 0 for r in rows), "total_hooks": sum(r[3] for r in rows),
        "total_catch_n": sum(r[4] for r in rows), "checks": "unique set IDs; positive effort; nonnegative catch; matching index and removal years"},
    "stage_compute_seconds": {"extract": time.perf_counter() - started},
    "choices": json.loads((ROOT / "pipeline/choices.json").read_text()),
}
if os.getenv("TOY_SOURCE_PROVIDER") == "supabase":
    shutil.copyfile(source, OUT / "source.sqlite")
    manifest["extraction_outputs"]["source.sqlite"] = manifest["source_sha256"]
    release = source.with_suffix('.release.json')
    if release.exists():
        manifest['data_release'] = json.loads(release.read_text())
        shutil.copyfile(release, OUT / 'source-release.json')
        manifest['extraction_outputs']['source-release.json'] = hashlib.sha256(release.read_bytes()).hexdigest()
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"EXTRACT complete: {len(rows)} synthetic sets, through {manifest['last_year']}; source {manifest['source_sha256'][:12]}")
