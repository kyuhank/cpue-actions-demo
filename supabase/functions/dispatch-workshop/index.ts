// Database webhook → the fixed public workshop workflow. No browser credentials.
Deno.serve(async (request: Request) => {
  const expected = Deno.env.get("WORKSHOP_WEBHOOK_SECRET");
  if (request.method !== "POST" || !expected || request.headers.get("x-workshop-webhook") !== expected)
    return new Response("Forbidden", { status: 403 });
  let event;
  try { event = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const version = event?.record?.version;
  if (event.type !== "INSERT" || event.schema !== "public" || event.table !== "cpue_releases" ||
      !Number.isInteger(version) || version < 2024 || version > 2035)
    return new Response("Unknown workshop event", { status: 400 });
  const token = Deno.env.get("WORKSHOP_GITHUB_TOKEN");
  if (!token) return new Response("Workflow connection is not configured", { status: 503 });
  const result = await fetch("https://api.github.com/repos/kyuhank/cpue-toy-data/actions/workflows/update.yml/dispatches", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cpue-workshop" },
    body: JSON.stringify({ ref: "main", inputs: { data_version: String(version) } }),
  });
  return new Response(result.ok ? "Workflow requested" : "GitHub dispatch failed", { status: result.ok ? 202 : 502 });
});
