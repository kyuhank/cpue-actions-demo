# Hosted data service

The service stores versioned synthetic data and connects accepted releases to the demonstration workflow.

- `schema.sql`, `seed.sql`, `quality-check.sql`: baseline data and publication checks.
- `snapshot.py`: materialise a selected release as a SQLite snapshot.
- `cloud-control.sql`: atomic request limits and dispatch deduplication.
- `demo-lifecycle.sql`, `demo-cron.sql`: expire visitor runs and restore the baseline.
- `functions/`: fixed workflow controls, status and output access.

Incoming data pass QC before publication. A release webhook triggers extraction and downstream analyses. Published data remain immutable during a demonstration.

Controls accept predefined synthetic updates only. Credentials remain server-side. Limits are 60 requests per UTC day, one active run and a 30-second interval. Cleanup starts ten minutes after completion, checked once per minute; request limits survive reset. The versioned baseline archive is retained for intermediate starts.

[Scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)

The shared demo retains one added batch (2024) above its 2023 baseline. Repeated data runs replay that accepted release; cleanup removes the added batch after the viewing window.
