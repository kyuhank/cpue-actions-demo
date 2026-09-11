"""Run the four toy stages and save their real outputs."""
from pathlib import Path
import runpy
import time
started = time.perf_counter()
for stage in ("extract", "cpue", "assessment", "report"):
    runpy.run_path(str(Path("pipeline") / (stage + ".py")), run_name="__main__")
print(f"All four stages completed in {time.perf_counter() - started:.3f}s. Open outputs/report.html")
