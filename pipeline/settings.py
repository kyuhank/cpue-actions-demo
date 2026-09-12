"""Versioned, bounded settings for the synthetic workshop analyses."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def stage_settings():
    path = ROOT / os.getenv('TOY_STAGE_CONFIG', 'config/stages.json')
    values = json.loads(path.read_text()) if path.exists() else {}
    rerunnable = {'extract', 'prepare_vessel', 'prepare_year', 'synthesis', 'report'}
    allowed = {'cpue_vessel', 'cpue_year', *[c['key'] for c in assessment_cases(False)], *rerunnable}
    if not isinstance(values, dict) or set(values) - allowed:
        raise ValueError('Unknown workshop setting')
    for key, value in values.items():
        field, options = ('revision', (0, 1)) if key in rerunnable else ('min_hooks', (0, 2000)) if key.startswith('cpue_') else ('M', (0.20, 0.25, 0.30, 0.35))
        if not isinstance(value, dict) or set(value) != {field} or value[field] not in options:
            raise ValueError('Invalid workshop setting')
    return values


def assessment_cases(configured=True):
    cases = json.loads((ROOT / 'pipeline/assessment_cases.json').read_text())
    if configured:
        modules = ROOT / 'module-versions.json'
        if modules.exists():
            sources = json.loads(modules.read_text())
            cases = [{**case, **{k: v for k, v in sources.get(case['key'], {}).get('specification', {}).items() if k == 'M'}} for case in cases]
        settings = stage_settings()
        cases = [{**case, **settings.get(case['key'], {})} for case in cases]
    return cases
