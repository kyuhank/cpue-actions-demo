# CPUE workflow demo

Synthetic records → extraction → two CPUE choices → input preparation → four toy assessments → report.

[Open the workshop demo](https://kyuhank.github.io/cpue-actions-demo/).
During a hosted session, visitors can start the real GitHub workflow without an account.
The browser companion also runs the calculations locally.

New data in [cpue-toy-data](https://github.com/kyuhank/cpue-toy-data) trigger
one GitHub job with ten recorded analysis steps using this repository’s pinned workflow. Each CPUE branch prepares
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

The fast presentation uses one GitHub runner and one Docker container, with ten recorded steps. `parallel-pipeline.yml` retains the separate-job example. Protected-data production would use approved HPC.
