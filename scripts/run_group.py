"""Run each selected stage in a group; pass outputs directly to the next group."""
from concurrent.futures import ThreadPoolExecutor
import json, os, subprocess, sys, time
from pathlib import Path
from stage_barrier import GROUPS

def visible_seconds(keys):
    seconds = float(os.getenv('WORKSHOP_GROUP_SECONDS', '2'))
    for prefix, setting in (('prepare_', 'WORKSHOP_INPUT_PREP_SECONDS'),
                            ('assessment_', 'WORKSHOP_ASSESSMENT_SECONDS')):
        if any(key.startswith(prefix) for key in keys):
            seconds = max(seconds, float(os.getenv(setting, str(seconds))))
    return max(0, min(10, seconds))

def run_group(number):
    plan=json.loads(Path('stages/_plan.json').read_text())['stages']
    keys=[k for k in GROUPS[number] if plan[k]['action']=='run']
    started=time.monotonic()
    def execute(key):
        print('START:',key,flush=True)
        subprocess.run([sys.executable,'-u','scripts/run_stage.py',key],check=True)
        print('COMPLETE:',key,flush=True)
    if keys:
        minimum = visible_seconds(keys)
        if minimum:
            print(f'PRESENTATION PACE: keep this group visible for at least {minimum:g} s', flush=True)
        with ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(execute,keys))
        # The real job holds completed files briefly so each group is visible live.
        time.sleep(max(0, minimum - (time.monotonic() - started)))
        pause=max(0,min(5,float(os.getenv('WORKSHOP_TRANSITION_SECONDS','0'))))
        if pause:
            print(f'PRESENTATION PACE: pause {pause:g} s before the next stage group',flush=True)
            time.sleep(pause)
    print('GROUP complete:',', '.join(keys) if keys else 'verified outputs reused',flush=True)
if __name__=='__main__':run_group(int(sys.argv[1]))
