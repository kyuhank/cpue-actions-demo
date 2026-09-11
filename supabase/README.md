# Supabase Free setup

Prepared for a new project; this connection is inactive until configured.

1. Create a **Free** Supabase project. Run `schema.sql`, then `seed.sql` in its SQL Editor. These contain wholly synthetic data through 2023.
2. In `kyuhank/cpue-toy-data`, add Actions secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the project's legacy `anon` JWT key). The workflow then reads versioned database snapshots instead of the repository's fallback database.
3. Deploy `dispatch-workshop` with `supabase functions deploy dispatch-workshop --project-ref PROJECT_REF`. Configure its secrets: `WORKSHOP_WEBHOOK_SECRET` (a random value) and `WORKSHOP_GITHUB_TOKEN` (a fine-grained token limited to **Actions: write** on `kyuhank/cpue-toy-data`). Keep these out of source files.
4. Add a Database Webhook on `public.cpue_releases`, **INSERT** only, pointing to that function's HTTPS URL. Set header `x-workshop-webhook` to the same webhook secret.
5. Configure the private presentation host using its Supabase setup note. The slide button appends a synthetic year; the database release triggers extraction, analyses, synthesis and reporting.

Snapshots are append-only. The extraction artifact also retains the exact SQLite snapshot used by the run. CPUE settings remain versioned in GitHub. Length compositions are an example of additional production inputs; this toy fits catch and CPUE only.

Rehearse after setup: confirm a new release produces a GitHub run named **Database version 2024** and a report with the same data version. A failed webhook can be retried by dispatching `update.yml` with that `data_version`.

Free projects pause after one week of inactivity; resume the project before presenting. [Plan](https://supabase.com/pricing) · [Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
