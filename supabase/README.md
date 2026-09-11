# Supabase Free setup

The demonstration uses a Free Supabase project in Sydney. [Release 2024 completed the full workflow](https://github.com/kyuhank/cpue-toy-data/actions/runs/34645434946).

The private presentation host has a setup command that checks the Free plan, creates the project and installs these files. This public directory contains only synthetic data and the database contract.

`schema.sql` and `seed.sql` establish the immutable baseline through 2023. Apply `quality-check.sql` after them; it also upgrades an existing demonstration database. `snapshot.py` downloads a particular database version into a deterministic SQLite snapshot for GitHub Actions. It accepts current publishable keys and legacy anon keys; writing requires a private server key.

The slide button checks one incoming year before publication. Missing values, duplicate IDs, invalid effort or catch, and inconsistent years return reasons for correction. Valid records are checked again inside the publication transaction; only a committed release triggers analysis. The validation result and SQL function hash are retained with that release. Test invalid data checks a fixed zero-effort example without writing any records. A release INSERT calls `dispatch-workshop`, which finds the active workshop session and notifies its authenticated, bounded relay. The private host dispatches only `kyuhank/cpue-toy-data/update.yml`, then GitHub reads the selected snapshot and runs extraction through reporting. GitHub credentials stay on the host. Sharing must be open; a stopped host cannot dispatch new jobs.

Connection values: the data repository's Actions secrets are `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Edge Function secrets are `WORKSHOP_WEBHOOK_SECRET` and `WORKSHOP_RELAY_SECRET`. No keys belong in this repository or the distributed slides.

Snapshots are append-only. The extraction artifact retains the exact SQLite snapshot, release metadata, SQL files and QC record used by the run. CPUE settings remain versioned in GitHub. Length compositions are an example of additional production inputs; this toy fits catch and CPUE only.

Rehearse after setup: confirm a new release produces a GitHub run named **Database version 2024** and a report with the same data version. A failed webhook can be retried by dispatching `update.yml` with that `data_version`.

Free projects pause after one week of inactivity; resume the project before presenting. [Plan](https://supabase.com/pricing) · [Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
