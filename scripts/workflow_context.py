"""Package the verified inputs and code for independent GitHub runners."""
import json, os
from pathlib import Path
import tarfile
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
keys=('TOY_CONTAINER_IMAGE','TOY_CODE_COMMIT','TOY_DATA_COMMIT','TOY_DATA_REPOSITORY','TOY_SOURCE_DATABASE','TOY_STAGE_CONFIG','TOY_SOURCE_PROVIDER','TOY_SOURCE_VERSION')
context={k:os.environ[k] for k in keys if os.environ.get(k)}
context['TOY_EXECUTION_MODE']='module_jobs'
(ROOT/'execution-context.json').write_text(json.dumps(context,indent=2)+'\n')
with tarfile.open('workflow-context.tar.gz','w:gz') as archive:
 for name in ('pipeline','scripts','data','source-data','config','modules.lock.json','module-branches.json','module-versions.json','module-checks.json','execution-context.json','stages'):
  if (ROOT/name).exists():archive.add(name,filter=lambda info:None if '__pycache__' in info.name else info)
print('CONTEXT: fixed code commits, selected database release, verified parent outputs and settings')
