"""Check visible task/job states from the same execution observations."""
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
KEYS=['submission','qc','ingest','extract','cpue_vessel','cpue_year','cpue_summary','cpue_report','prepare_vessel','prepare_year','assessment_vessel_ref','assessment_vessel_high_m','assessment_year_ref','assessment_year_high_m','synthesis','report']
state={'ready':True,'has_run':True,'run_id':1,'number':1,'commit':'a'*40,'status':'in_progress','source':{'last_success':'2026-09-13T12:00:00Z'},'execution':{},
       'stages':[{'key':k,'parents':[],'status':'waiting','source_id':'1-1-'+k} for k in KEYS]}
with sync_playwright() as pw:
 browser=pw.chromium.launch();page=browser.new_page(viewport={'width':1145,'height':488});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def route(r):
  path=urlparse(r.request.url).path
  assert r.request.method=='GET'
  if path=='/api/status':r.fulfill(json=state)
  elif path=='/api/stage-log':r.fulfill(json={'source':'GitHub execution record','lines':['Run module · in progress']})
  elif path in ('/guest.html','/guest.css','/guest.js','/cloud.js'):
   r.fulfill(body=(ROOT/'docs'/path[1:]).read_text(),content_type='text/html' if path.endswith('html') else 'text/css' if path.endswith('css') else 'text/javascript')
  else:r.fulfill(json={'files':[]})
 page.route('**/*',route);page.goto('https://workshop.test/guest.html');page.wait_for_selector('.task-card')
 def update(running=(),reused=(),phase=None,failed=()):
  page.evaluate('''([running,reused,phase,failed])=>{
   data.has_run=true;for(const s of data.stages){s.status=running.includes(s.key)?'running':failed.includes(s.key)?'failed':'completed';s.reused=reused.includes(s.key);s.correction_phase=s.key==='qc'?phase:null;}draw();
  }''',[running,reused,phase,failed])
 for width in (1145,1000):
  page.set_viewport_size({'width':width,'height':488})
  update(['cpue_vessel','cpue_year'])
  task=page.locator('[data-task=cpue]');assert task.get_attribute('data-state')=='running'
  assert task.locator('.status-badge').inner_text()=='2 running'
  assert task.locator('[data-status-icon=running]').count()==1
  assert task.locator('.task-activity').inner_text()=='Now · Analysis A · Analysis B'
  assert page.locator('.task-card.is-running').count()==1
  assert page.locator('#task-cards').evaluate('el=>el.getBoundingClientRect().bottom<innerHeight'), 'Task cards extend beyond slide'
  if width==1145:
   page.wait_for_timeout(250);page.screenshot(path='/tmp/orchestration-running.png')
  # Polling should not replace the focused task button.
  task.focus();page.evaluate('taskCards()');assert task.evaluate('el=>el===document.activeElement')
  task.click();assert page.locator('#rows .job-row.is-running').count()==2
  page.locator('#rows .job-row.is-running td:first-child button').first.click()
  assert 'Running' in page.locator('#job-state').inner_text()
  page.locator('#files-back').click();page.get_by_role('button',name='Tasks',exact=True).click()
  update([],['cpue_vessel','cpue_year','cpue_summary','cpue_report'])
  assert task.get_attribute('data-state')=='reused' and page.locator('.task-card.is-running').count()==0
  update(['assessment_vessel_ref'],failed=['assessment_year_ref'])
  assert page.locator('[data-task=assessment]').get_attribute('data-state')=='running'
  update([],failed=['assessment_year_ref'])
  assert page.locator('[data-task=assessment]').get_attribute('data-state')=='failed'
  update(['qc'],phase='returned');assert page.locator('[data-task=qc]').get_attribute('data-state')=='returned'
  update(['qc'],phase='resubmitting')
  assert page.locator('[data-task=submission]').get_attribute('data-state')=='running'
  assert page.locator('[data-task=qc]').get_attribute('data-state')=='waiting'
  update(['qc'],phase='rechecking');assert page.locator('[data-task=qc]').get_attribute('data-state')=='running'
  update([],phase='corrected');assert page.locator('.task-card.is-running').count()==0
  page.evaluate('data.has_run=false;draw()');assert page.locator('.task-card.is-ready').count()==9
 assert not errors,errors
 browser.close()
print('Running tasks list active jobs; rows and job details agree; correction phases, completion, reuse and narrow slide layouts checked.')
