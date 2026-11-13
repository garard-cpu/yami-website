// Turns a Yami grocery list into an Instacart shopping list page.
// Needs INSTACART_API_KEY set in Cloudflare Pages (Settings > Variables and Secrets). Until then GET says configured: false.
// Docs: https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page

export const onRequest = async ({ request: req, env }) => {
  const key = env.INSTACART_API_KEY;
  const base = env.INSTACART_BASE_URL || "https://connect.instacart.com";
  if (req.method === "GET") return Response.json({ configured: !!key });
  if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  if (!key) return Response.json({ error: "not_configured" }, { status: 501 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x) => String((x && x.n) || x || "").trim())
    .filter(Boolean)
    .slice(0, 100);
  if (!items.length) return Response.json({ error: "No items" }, { status: 400 });

  const res = await fetch(`${base}/idp/v1/products/products_link`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      title: "My Yami grocery list",
      link_type: "shopping_list",
      line_items: items.map((name) => ({ name: name.replace(/\s*\(.*?\)\s*/g, " ").trim(), display_text: name })),
      landing_page_configuration: { partner_linkback_url: body.back || undefined },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.products_link_url) return Response.json({ error: "instacart_error", detail: data }, { status: 502 });
  return Response.json({ url: data.products_link_url });
};
