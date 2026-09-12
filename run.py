"""Run the five toy stages and save their real outputs."""
from pathlib import Path
import runpy
import time
started = time.perf_counter()
if Path('scripts/run_workflow.py').exists():
    runpy.run_path('scripts/run_workflow.py', run_name='__main__')
    raise SystemExit(0)
for stage in ("extract", "cpue", "prepare_inputs", "assessment", "report"):
    runpy.run_path(str(Path("pipeline") / (stage + ".py")), run_name="__main__")
print(f"All five stages completed in {time.perf_counter() - started:.3f}s. Open outputs/report.html")
