# Hosted synthetic demonstration

The Supabase Free project holds the synthetic baseline through 2023. `schema.sql`, `seed.sql` and `quality-check.sql` install the data and publication checks. `snapshot.py` downloads a specified release into a deterministic SQLite snapshot.

A new year passes QC before publication. The database release webhook dispatches the fixed GitHub workflow directly; no presentation host is involved. GitHub reads that snapshot and executes extraction through reporting. The server credential stays in Supabase Edge Function secrets.

`cloud-control.sql` enforces 60 shared requests per UTC day, one active request and a 30-second interval. `demo-lifecycle.sql` restores the baseline after the latest completed run's ten-minute viewing period. `demo-cron.sql` checks cleanup each minute independently of the browser, deleting the demonstration's GitHub runs, artifacts and temporary branch. Today's request counters survive resets. Normal publication remains immutable; reset is an explicit exception for this disposable synthetic example.

Use a fine-grained token restricted to **kyuhank/cpue-toy-data**, with Contents and Actions read/write only. Store it as `WORKSHOP_GITHUB_TOKEN`, with the owner's confirmed zero-dollar Actions stop recorded as `WORKSHOP_ZERO_BUDGET_CONFIRMED=true`. Never put credentials in public files or slides. Guests can invoke only fixed stage updates and synthetic batches; the cleanup endpoint requires a separate server secret.

The first run calculates initial inputs. Later updates reuse verified outputs from the same temporary branch. Production analyses would retain accepted snapshots, code, environments and results in an approved archive.

[Scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions) · [Server secrets](https://supabase.com/docs/guides/functions/secrets)
