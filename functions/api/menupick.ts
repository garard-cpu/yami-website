// Campus menu matcher for the Yami app at /app. A student says a meal is from a campus spot ("SunLife Organics")
// and snaps it. The app POSTs { image, spot, menu: [{ id, n, desc }] } with that spot's real menu, and gets back
// { picks: [{ id, why }] }: the menu items the photo most likely shows, most likely first.
// The Claude key lives only in Cloudflare Pages' environment variables (ANTHROPIC_API_KEY), never in the page.

const PROMPT = `You help Yami, a nutrition app for USC students, log a meal from a campus spot with that spot's real menu nutrition.

The student says the meal in the photo is from the spot they name, and you get that spot's menu: each item's id, name and what it contains. Look at the photo for clues: cup or wrapper logos, the base (acai, pitaya, rice, greens), toppings, sauces, colors, size and container. Decide which menu item it is.

Return up to 3 menu ids, most likely first. In why, say in one short sentence which clues you saw ("acai base with strawberry, banana, blueberry and bee pollen"). Only return ids from the menu you were given. If nothing on the menu matches the photo, return an empty list.`;

type MenuItem = { id: string; n: string; desc?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Env = { ANTHROPIC_API_KEY?: string };

export const onRequest = async ({ request: req, env }: { request: Request; env: Env }) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "no-key" }, 503);

  let body: { image?: unknown; spot?: unknown; menu?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad-json" }, 400);
  }
  const img = typeof body.image === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
  if (!img) return json({ error: "bad-image" }, 400);
  if (img[2].length > 7_000_000) return json({ error: "too-big" }, 413);
  const spot = typeof body.spot === "string" ? body.spot.trim().slice(0, 80) : "";
  const menu: MenuItem[] = (Array.isArray(body.menu) ? body.menu : [])
    .filter((m): m is MenuItem => !!m && typeof (m as MenuItem).id === "string" && typeof (m as MenuItem).n === "string")
    .slice(0, 90)
    .map((m) => ({ id: m.id.slice(0, 120), n: m.n.slice(0, 100), desc: typeof m.desc === "string" ? m.desc.slice(0, 240) : "" }));
  if (!spot || !menu.length) return json({ error: "missing" }, 400);
  const ids = menu.map((m) => m.id);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["picks"],
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "why"],
          properties: { id: { type: "string", enum: ids }, why: { type: "string" } },
        },
      },
    },
  };

  const menuText = menu.map((m) => `${m.id}: ${m.n}${m.desc ? " (" + m.desc + ")" : ""}`).join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 800,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        system: PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: img[1], data: img[2] } },
              { type: "text", text: `The student says this is from ${JSON.stringify(spot)}. Its menu:\n${menuText}` },
            ],
          },
        ],
      }),
    });
    if (res.status === 429 || res.status === 529) return json({ error: "busy" }, 429);
    if (!res.ok) return json({ error: "claude", status: res.status }, 502);
    const response = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (response.stop_reason === "refusal") return json({ picks: [] });
    const text = (response.content || []).find((block) => block.type === "text")?.text;
    if (!text) return json({ error: "empty" }, 502);
    const raw = JSON.parse(text) as { picks?: { id?: unknown; why?: unknown }[] };
    const picks: { id: string; why: string }[] = [];
    for (const p of raw.picks || []) {
      if (typeof p.id !== "string" || !ids.includes(p.id) || picks.some((x) => x.id === p.id)) continue;
      picks.push({ id: p.id, why: typeof p.why === "string" ? p.why.slice(0, 160) : "" });
    }
    return json({ picks: picks.slice(0, 3) });
  } catch {
    return json({ error: "unreadable" }, 502);
  }
};
