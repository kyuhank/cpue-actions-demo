# CPUE workflow demo

Synthetic longline records → extraction → two CPUE choices → toy Schaefer fits → report.

[Open the workshop demo](https://kyuhank.github.io/cpue-actions-demo/).
During a hosted session, visitors can start the real GitHub workflow without an account.
The browser companion also runs the calculations locally.

New data in [cpue-toy-data](https://github.com/kyuhank/cpue-toy-data) trigger
five GitHub jobs using this repository’s pinned workflow. Two CPUE jobs run in
parallel; assessment waits for both and checks their inputs before fitting.
Kflow2 is a separate private orchestration app; its source is not included here.

```bash
python3 run.py
```

Open `outputs/report.html` for data checks, fitted results, diagnostics and provenance.
Python standard library only; reference R fits are retained for comparison.
The small runtime image is built in [ofp-sam-docker-images](https://github.com/PacificCommunity/ofp-sam-docker-images/tree/main/cpue-workshop).
All data and results are synthetic examples, with no management interpretation.
