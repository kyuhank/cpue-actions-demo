# CPUE workflow demo

An executable example connecting synthetic fishery data to CPUE indices, assessment inputs, model comparisons and a report.

[Open the demo](https://kyuhank.github.io/cpue-actions-demo/)

```mermaid
flowchart LR
    D[Data + QC] --> E[Extraction]
    E --> C[CPUE analyses]
    E --> I[Input preparation]
    C --> I --> A[Assessment models]
    A --> S[Results synthesis] --> R[Report]
```

Select a stage to rerun it and its dependants. Verified, unchanged outputs are reused. Independent analyses run in parallel within one GitHub runner and a pinned container. The orchestration view exposes each stage’s outputs and execution records.

A versioned baseline supports intermediate starts, including after reset. Visitor runs expire ten minutes after completion; the fixed baseline remains available.

## Run locally

```bash
python3 run.py
```

Open `outputs/report.html`. Python standard library only.

The example compares two CPUE formulations and four age-structured assessment configurations. All data are synthetic; model assumptions and limitations are recorded in the report.

[Data and triggers](https://github.com/kyuhank/cpue-toy-data) · [Hosted data service](supabase/README.md) · [Container](https://github.com/PacificCommunity/ofp-sam-docker-images/tree/main/cpue-workshop)
