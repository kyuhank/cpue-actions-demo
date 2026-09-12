"""Submit, check, and prepare the fixed synthetic batch in separate Actions jobs."""
import hashlib, html, json, os, sys, tarfile, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parents[1]
IMAGE=os.getenv('TOY_CONTAINER_IMAGE','local')
def digest(value):return hashlib.sha256(value).hexdigest()
def canonical(value):return json.dumps(value,separators=(',',':'),ensure_ascii=True).encode()
def check(batch):
    errors=[];seen=set()
    for row in batch['sets']:
        ident,year,vessel,hooks,catch=row
        for condition,code,field,message,value in [
            (ident not in seen,'duplicate_id','set_id','Submission identifiers must be unique.',ident),
            (year==2024,'year','year','Every submitted record must be from 2024.',year),
            (isinstance(vessel,str) and bool(vessel),'vessel','vessel','A vessel identifier is required.',vessel),
            (isinstance(hooks,int) and hooks>0,'positive_effort','hooks','Hooks must be greater than zero.',hooks),
            (isinstance(catch,int) and catch>=0,'catch','catch_n','Catch must be non-negative.',catch)]:
            if not condition:errors.append({'code':code,'field':field,'message':message,'failed_records':1,'examples':[{'set_id':ident,'observed':value}]})
        seen.add(ident)
    if not batch['sets'] or not isinstance(batch['catch'],(int,float)) or batch['catch']<0:errors.append({'code':'annual_catch','message':'Valid records and annual catch are required.'})
    return {'accepted':not errors,'proposed_version':2024,'rows_received':len(batch['sets']),'errors':errors,'checks':['unique identifiers','submission year','vessel identifiers','positive effort','non-negative catch'],'rule_version':1,'rules_sha256':digest(Path(__file__).read_bytes())}
def write(key,files,success=True):
    folder=ROOT/'stages'/key;out=folder/'outputs';out.mkdir(parents=True,exist_ok=True)
    for name,value in files.items():(out/name).write_text(json.dumps(value,indent=2)+'\n')
    sys.path.insert(0,str(ROOT/'pipeline'))
    from stage_html import intake_page
    (out/'results.html').write_text(intake_page(key,out,success))
    record={'stage':key,'run_id':os.getenv('GITHUB_RUN_ID','local'),'attempt':os.getenv('GITHUB_RUN_ATTEMPT','1'),'code_commit':os.getenv('TOY_CODE_COMMIT','local'),'container':IMAGE,'status':'completed' if success else 'failed','completed_at':datetime.now(timezone.utc).isoformat(),'outputs':{p.name:digest(p.read_bytes()) for p in out.iterdir()}}
    (folder/'record.json').write_text(json.dumps(record,indent=2)+'\n')
    name=f'stage-{record["attempt"]}-{key}.tar.gz'
    with tarfile.open(ROOT/name,'w:gz') as archive:archive.add(folder,arcname='stages/'+key)
def main():
    key=sys.argv[1]
    if key=='submission':
        batch=json.loads((ROOT/'supabase/functions/workshop-api/batches.json').read_text())['2024']
        if os.getenv('WORKSHOP_INTAKE_MODE')=='invalid':batch['sets'][0][3]=0
        write(key,{'submission.json':batch,'receipt.json':{'owner':'Korea','release':2024,'rows':len(batch['sets']),'sha256':digest(canonical(batch))}})
        print(f'SUBMISSION complete: Korea; {len(batch["sets"])} records; receipt and checksum saved',flush=True)
    elif key=='return':
        rejected=json.loads((ROOT/'stages/qc/outputs/quality.json').read_text())
        if rejected['accepted']:raise SystemExit('No failed check to return')
        print('RETURN: hooks must be greater than zero; correction request saved for the submitted record',flush=True)
        write('qc',{'first-quality.json':rejected,'return.json':{'status':'returned','reason':rejected['errors'][0]['message']}},False)
        time.sleep(min(3,float(os.getenv('WORKSHOP_INTAKE_SECONDS','3'))))
    elif key=='resubmit':
        original=json.loads((ROOT/'stages/submission/outputs/submission.json').read_text())
        rejected=json.loads((ROOT/'stages/qc/outputs/quality.json').read_text())
        fixed=json.loads((ROOT/'supabase/functions/workshop-api/batches.json').read_text())['2024']
        expected=json.loads(json.dumps(fixed));expected['sets'][0][3]=0
        if os.getenv('WORKSHOP_INTAKE_MODE')!='invalid' or original!=expected or rejected['accepted'] or [e['code'] for e in rejected['errors']]!=['positive_effort']:
            raise SystemExit('Only the fixed demonstration correction may be resubmitted automatically')
        print('RETURN: hooks must be greater than zero; submission returned with the failed record ID',flush=True)
        print('RESUBMIT: applying the predefined demonstration correction once',flush=True)
        time.sleep(min(3,float(os.getenv('WORKSHOP_INTAKE_SECONDS','3'))))
        write('qc',{'first-quality.json':rejected,'accepted-submission.json':fixed,'correction.json':{
            'automatic_demo_correction':True,'attempt':2,'field':'hooks','set_id':fixed['sets'][0][0],
            'before':0,'after':fixed['sets'][0][3],'original_sha256':digest(canonical(original)),
            'resubmitted_sha256':digest(canonical(fixed))}},False)
        print('RESUBMIT complete: corrected example saved; QC must pass before loading',flush=True)
    elif key=='qc':
        corrected=ROOT/'stages/qc/outputs/accepted-submission.json'
        batch=json.loads((corrected if corrected.exists() else ROOT/'stages/submission/outputs/submission.json').read_text());quality=check(batch)
        if corrected.exists():time.sleep(min(3,float(os.getenv('WORKSHOP_INTAKE_SECONDS','3'))))
        write(key,{'quality.json':quality},quality['accepted'])
        for error in quality['errors']:print('::error title=QC returned to Korea::'+error['message']+' '+json.dumps(error.get('examples',[])),flush=True)
        print('QC '+('complete: accepted; release may be prepared' if quality['accepted'] else 'FAILED: returned to Korea; correct and resubmit; loading and extraction blocked'),flush=True)
        if not quality['accepted']:raise SystemExit(1)
    elif key=='ingest':
        corrected=ROOT/'stages/qc/outputs/accepted-submission.json'
        batch=json.loads((corrected if corrected.exists() else ROOT/'stages/submission/outputs/submission.json').read_text());quality=json.loads((ROOT/'stages/qc/outputs/quality.json').read_text())
        if not quality['accepted'] or not check(batch)['accepted']:raise SystemExit('QC did not pass')
        batch['sets']=sorted(batch['sets'],key=lambda r:r[0]);sha=digest(canonical(batch))
        print('PREPARE: normalise fields; sort record identifiers; verify the accepted batch checksum',flush=True)
        audience='cpue-workshop-intake'
        endpoint=os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']+'&'+urlencode({'audience':audience})
        with urlopen(Request(endpoint,headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}),timeout=20) as response:token=json.load(response)['value']
        payload=canonical({'request':os.environ['WORKSHOP_REQUEST_ID'],'batch_sha256':sha})
        endpoint=os.environ['SUPABASE_URL']+'/functions/v1/workshop-api/api/accept-intake'
        for attempt in range(3):
            try:
                with urlopen(Request(endpoint,data=payload,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=45) as response:release=json.load(response)
                break
            except HTTPError as error:
                if error.code==503 and attempt<2:
                    print('VERIFY: waiting for GitHub to confirm the completed QC record',flush=True)
                    time.sleep(2)
                    continue
                write(key,{'load-error.json':{'status':'failed','http_status':error.code,'message':'The checked run could not be verified. No downstream analysis was started.'}},False)
                raise SystemExit('LOAD stopped: checked-run verification failed (HTTP '+str(error.code)+')')
        write(key,{'release.json':release,'prepared.json':{'rows':len(batch['sets']),'sha256':sha,'version':2024}})
        print('LOAD complete: checked release v2024 stored in PostgreSQL; extraction unlocked',flush=True)
    else:raise SystemExit('Unknown intake stage')
if __name__=='__main__':main()
