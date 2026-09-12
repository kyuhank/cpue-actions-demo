# Hosted data service

Stores synthetic database releases and provides restricted controls for the public demo. Credentials remain on the server.

| Files | Purpose |
| --- | --- |
| `schema.sql`, `seed.sql`, `quality-check.sql` | Baseline data and publication checks |
| `saved-snapshots.sql` | Fixed 2021 and 2022 snapshots alongside the 2023 baseline |
| `snapshot.py` | Export a selected release to SQLite |
| `cloud-control.sql` | Atomic request limits and dispatch deduplication |
| `demo-lifecycle.sql`, `demo-cron.sql` | Expire visitor runs and restore the baseline |
| `functions/` | Workflow controls, status and output access |

Only predefined synthetic updates are accepted. QC runs before publication; an accepted release triggers extraction and downstream analyses. A published release stays unchanged during its run.

Limits: **1,000 shared requests per UTC day**, one active run and a 30-second interval between requests. Limits survive demo resets.

Cleanup begins ten minutes after completion and is checked once per minute. The added batch and visitor outputs expire; fixed snapshots and the baseline archive remain available. Data are bounded to the 2023 baseline plus one 2024 batch.
