"""Warm intake runners wait for successful, recorded upstream jobs."""
import json, os, sys, time
from urllib.request import Request, urlopen

def ready(jobs, required):
    pending=[]
    for key in required:
        job=next((j for j in jobs if '['+key+']' in j.get('name','')),None)
        if job and job.get('conclusion') in ('failure','cancelled','timed_out','skipped','action_required'):
            raise RuntimeError('Upstream job did not succeed: '+key)
        if not job or job.get('conclusion')!='success':pending.append(key)
    return not pending

def main():
    required={'qc':['submission'],'ingest':['submission','qc']}[sys.argv[1]]
    repo=os.environ['GITHUB_REPOSITORY'];run=os.environ['GITHUB_RUN_ID'];attempt=os.environ['GITHUB_RUN_ATTEMPT']
    if repo not in ('kyuhank/cpue-toy-data','kyuhank/cpue-actions-demo') or not run.isdigit() or not attempt.isdigit():raise SystemExit('Unknown run')
    url=f'https://api.github.com/repos/{repo}/actions/runs/{run}/attempts/{attempt}/jobs?per_page=100'
    request=Request(url,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
    deadline=time.monotonic()+150
    print('WAIT: prepared runner; waiting for '+', '.join(required),flush=True)
    while time.monotonic()<deadline:
        with urlopen(request,timeout=15) as response:jobs=json.load(response)['jobs']
        if ready(jobs,required):print('READY: upstream jobs passed; retrieve their saved outputs',flush=True);return
        time.sleep(1)
    raise SystemExit('Upstream intake jobs did not finish in time')
if __name__=='__main__':main()
