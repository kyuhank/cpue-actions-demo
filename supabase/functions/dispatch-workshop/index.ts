// A database release notifies the bounded presentation host. GitHub keys stay there.
export async function handle(request: Request) {
  const expected = Deno.env.get("WORKSHOP_WEBHOOK_SECRET");
  if (request.method !== "POST" || !expected || request.headers.get("x-workshop-webhook") !== expected)
    return new Response("Forbidden", { status: 403 });
  let event;
  try {
    const body = await request.text();
    if (body.length > 2048) throw new Error();
    event = JSON.parse(body);
  } catch { return new Response("Invalid JSON", { status: 400 }); }
  const version = event?.record?.version;
  if (event?.type !== "INSERT" || event.schema !== "public" || event.table !== "cpue_releases" ||
      !Number.isInteger(version) || version < 2024 || version > 2035)
    return new Response("Unknown workshop event", { status: 400 });
  const relaySecret = Deno.env.get("WORKSHOP_RELAY_SECRET");
  if (!relaySecret) return new Response("Workshop connection is not configured", { status: 503 });
  try {
    const pointer = await fetch("https://raw.githubusercontent.com/kyuhank/cpue-actions-demo/main/docs/session.json?t=" + Date.now(),
      { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!pointer.ok) throw new Error();
    const session = await pointer.json();
    if (session.active !== true || !(Date.parse(session.expires) > Date.now()) ||
        !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com$/.test(session.url))
      return new Response("Open the workshop sharing session before updating the database", { status: 503 });
    const result = await fetch(session.url + "/api/database-release", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { "Content-Type": "application/json", "X-Workshop-Relay": relaySecret },
      body: JSON.stringify({ version }),
    });
    return new Response(result.ok ? "Workflow requested" : "Workshop dispatch was not confirmed",
      { status: result.ok ? 202 : 502 });
  } catch { return new Response("Workshop host is unavailable", { status: 502 }); }
}

Deno.serve(handle);
