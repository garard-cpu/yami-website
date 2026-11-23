// Brand lookup for the Yami app at /app. After a scan, a student can say which brand a food is
// ("Chobani" for "Nonfat Greek yogurt"). The app POSTs { food, brand } and gets back
// { products: [{ name, serving, cal, carb, fat, protein, fiber, sugar, sodium }] } read from real Nutrition Facts labels.
// The Claude key lives only in Cloudflare Pages' environment variables (ANTHROPIC_API_KEY), never in the page.

const PROMPT = `You help Yami, a nutrition app for USC students, match a food from a meal photo to the exact product the student ate.

The student tells you the food Yami saw and the brand it came from. List up to 4 real products from that brand that match the food, such as its different fat levels, flavors or sizes (for "Greek yogurt" from "Chobani": Chobani Plain Nonfat Greek Yogurt, Chobani Whole Milk Plain Greek Yogurt, and so on). Put the brand's own product name in name, starting with the brand.

Use each product's real Nutrition Facts label for one serving, and say the serving as the label does ("1 container (150g)", "3/4 cup (170g)"). sodium is in mg; everything else except cal is in grams.

Only list products you are confident exist. If the brand doesn't make this food or you aren't sure, return an empty list. Never invent a product.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["products"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "serving", "cal", "carb", "fat", "protein", "fiber", "sugar", "sodium"],
        properties: {
          name: { type: "string" },
          serving: { type: "string" },
          cal: { type: "number" },
          carb: { type: "number" },
          fat: { type: "number" },
          protein: { type: "number" },
          fiber: { type: "number" },
          sugar: { type: "number" },
          sodium: { type: "number" },
        },
      },
    },
  },
};

type Product = { name: string; serving: string; cal: number; carb: number; fat: number; protein: number; fiber: number; sugar: number; sodium: number };

const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v * 10) / 10)) : 0);

// Checks what the model returned before the app trusts it: a label is never negative or thousands of calories.
function clean(raw: unknown): Product[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { products?: unknown }).products) ? (raw as { products: unknown[] }).products : [];
  const out: Product[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim().slice(0, 90) : "";
    if (!name || out.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({
      name,
      serving: typeof e.serving === "string" && e.serving.trim() ? e.serving.trim().slice(0, 40) : "1 serving",
      cal: num(e.cal, 2000),
      carb: num(e.carb, 300),
      fat: num(e.fat, 200),
      protein: num(e.protein, 200),
      fiber: num(e.fiber, 100),
      sugar: num(e.sugar, 200),
      sodium: num(e.sodium, 5000),
    });
  }
  return out.slice(0, 4);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Env = { ANTHROPIC_API_KEY?: string };

export const onRequest = async ({ request: req, env }: { request: Request; env: Env }) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "no-key" }, 503);

  let body: { food?: unknown; brand?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad-json" }, 400);
  }
  const food = typeof body.food === "string" ? body.food.trim().slice(0, 80) : "";
  const brand = typeof body.brand === "string" ? body.brand.trim().slice(0, 60) : "";
  if (!food || !brand) return json({ error: "missing" }, 400);

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
        max_tokens: 1500,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: PROMPT,
        messages: [{ role: "user", content: `Food Yami saw: ${JSON.stringify(food)}\nBrand: ${JSON.stringify(brand)}` }],
      }),
    });
    if (res.status === 429 || res.status === 529) return json({ error: "busy" }, 429);
    if (!res.ok) return json({ error: "claude", status: res.status }, 502);
    const response = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (response.stop_reason === "refusal") return json({ products: [] });
    const text = (response.content || []).find((block) => block.type === "text")?.text;
    if (!text) return json({ error: "empty" }, 502);
    return json({ products: clean(JSON.parse(text)) });
  } catch {
    return json({ error: "unreadable" }, 502);
  }
};
