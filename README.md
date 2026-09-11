# CPUE workflow demo

A synthetic-data example: extraction → CPUE → toy assessment → Quarto report.

[cpue-toy-data](https://github.com/kyuhank/cpue-toy-data) calls this repository’s
reusable workflow when new data are committed. Four dependent jobs run on
GitHub-hosted Ubuntu runners; each passes its outputs to the next.

The CPUE models compare year + vessel and year only. Each index feeds a simple
Schaefer model. All data are synthetic; results are for demonstration only.
Kflow2 code is kept separately and privately.

To run locally with Python, base R and Quarto:

```bash
python3 pipeline/extract.py
Rscript pipeline/cpue.R
Rscript pipeline/assessment.R
python3 pipeline/report.py
```

Open `outputs/report.html`. GitHub uses R 4.5.1 and Quarto 1.7.31.
