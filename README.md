# CPUE workflow demo

A synthetic-data example: extraction → CPUE → toy assessment → HTML report.

[cpue-toy-data](https://github.com/kyuhank/cpue-toy-data) calls this repository’s
reusable workflow when new data are committed. Four dependent jobs run on
GitHub-hosted Ubuntu runners; each passes its outputs to the next.

The CPUE models compare year + vessel and year only. Each index feeds a simple
Schaefer model. All data are synthetic; results are for demonstration only.
Kflow2 code is kept separately and privately.

To run locally with Python (standard library only):

```bash
python3 pipeline/extract.py
python3 pipeline/cpue.py
python3 pipeline/assessment.py
python3 pipeline/report.py
```

Open `outputs/report.html`. Reference R fits are retained for comparison.
The GitHub jobs need no additional software installation.
