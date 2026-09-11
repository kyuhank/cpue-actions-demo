# CPUE workflow demo

Synthetic records → extraction → two CPUE choices → input preparation → four toy assessments → results synthesis → report.

[Open the workshop demo](https://kyuhank.github.io/cpue-actions-demo/).
The cloud-connected views need no presentation host. Once the owner connects the restricted credential and confirms a $0 Actions spending budget, visitors can run the fixed demonstration without an account.
The browser companion also runs the calculations locally. Demo changes use a temporary branch. Ten minutes after the latest run completes, the server removes its run history and outputs and restores the synthetic baseline.

New data in [cpue-toy-data](https://github.com/kyuhank/cpue-toy-data) trigger
one GitHub job with eleven recorded stages using this repository’s pinned workflow. Input preparation combines each CPUE index with extracted catches; the full assessment would also assemble compositions and other inputs. Each CPUE branch prepares
its input and runs two assessment settings. The report checks and collects all four results.
Kflow2 is a separate private orchestration app; its source is not included here.

```bash
python3 run.py
```

Open `outputs/report.html` for data checks, fitted results, diagnostics and provenance.
Python standard library only. The annual age-structured toy fits recruitment and catchability under two illustrative M assumptions (0.20 / 0.30 per year). Fixed biology, catch checks and model limitations are recorded in the report.
The small runtime image is built in [ofp-sam-docker-images](https://github.com/PacificCommunity/ofp-sam-docker-images/tree/main/cpue-workshop).
The seeded generator includes a long-term abundance change, correlated annual availability, varying effort and lognormal–Poisson set catches. Vessel composition changes over time. The deliberately simple CPUE mean models do not estimate uncertainty.
All data and results are synthetic examples, with no management interpretation.

The presentation uses one GitHub runner and one Docker container. New data run all eleven stages; a CPUE filter change runs six, and one M change runs three. Unchanged outputs are reused only when data, code, container, stage settings and parent fingerprints match, with file checksums verified. Each executed stage includes a four-second presentation pause; computation time is recorded separately. `parallel-pipeline.yml` retains the separate-job example. Protected-data production would use approved HPC.

Hosted data and fixed cloud controls: [Supabase Free setup](supabase/README.md). The repository snapshot is a fallback for local calculations.
