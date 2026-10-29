import Anthropic from "@anthropic-ai/sdk";

// Reads a meal photo for the Yami app at /app. The app calls GET /api/vision to check this is here,
// then POSTs { image: "data:image/jpeg;base64,...", place } and gets back { food, meal, place, items }.
// The Claude key lives only in Netlify's environment variables (ANTHROPIC_API_KEY), never in the page.

const PLACE_IDS = ["parkside", "village", "starbucks", "chipotle", "home", "elsewhere"];
const PLACE_LABELS: Record<string, string> = { parkside: "Parkside", village: "USC Village Dining Hall", starbucks: "Starbucks", chipotle: "Chipotle", home: "Home", elsewhere: "Somewhere else" };

// A 1024 px JPEG from the app is well under 1 MB; anything far bigger isn't from the app.
const MAX_IMAGE_CHARS = 4_000_000;

const PROMPT = `You read meal photos for Yami, a nutrition app for USC students. Most meals come from USC dining halls (Parkside, USC Village Dining Hall), the Village and TCC restaurants, or chains on and near campus such as Starbucks and Chipotle.

List every distinct food or drink you can see, as the person would name it. Split plates into components: a burrito bowl is rice, beans, chicken, salsa, and so on; a dining hall plate is each item on it. Sauces and dressings count when visible. Skip plates, cups, utensils, and packaging.

For each item:
- name: short and natural, in title case ("Cilantro-lime rice", "Grilled chicken", "Iced latte"). Use the chain's own menu name when the place is a chain.
- usda: a plain generic phrase USDA FoodData Central would know ("rice white cooked", "chicken breast grilled", "coffee latte with milk", "black beans"). Never a brand name.
- grams: your best estimate of the amount on the plate or in the cup, in grams (a drink: its volume in ml as grams). Use visible cues like plate size, utensils, and cup size.
- size: small, regular, or large compared with a typical serving of that food.
- kind: the food's main group. Beans, lentils, tofu and edamame are plant protein; eggs, meat and fish are animal protein; yogurt and cheese are dairy.
- whole: true if it's a whole or lightly processed food (vegetables, fruit, beans, plain meat, whole grains), false for processed or packaged foods, pastries, fried snacks and sugary drinks.

meal: a short name for the whole meal ("Chipotle chicken bowl", "Breakfast plate", "Starbucks iced latte").
place: the place id if logos, cups, wrappers, napkins, bowls, lids, or the food itself make it clear, otherwise null. Chipotle's foil-lined bowls, brown napkins and red logo, or a Starbucks cup, are clear enough. When you know the place, name the meal after it ("Chipotle chicken burrito bowl"). If the person already said where they are, trust that.
food: false if the photo has no food or drink in it; then return no items.

Estimate honestly; the person can correct anything. Never comment on whether the meal is good or bad.`;

type VisionItem = { name: string; usda: string; grams: number; size: "small" | "regular" | "large"; kind: string; whole: boolean };
type VisionResult = { food: boolean; meal: string; place: string | null; items: VisionItem[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["food", "meal", "place", "items"],
  properties: {
    food: { type: "boolean" },
    meal: { type: "string" },
    place: { anyOf: [{ type: "string", enum: PLACE_IDS }, { type: "null" }] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "usda", "grams", "size", "kind", "whole"],
        properties: {
          name: { type: "string" },
          usda: { type: "string" },
          grams: { type: "number" },
          size: { type: "string", enum: ["small", "regular", "large"] },
          kind: { type: "string", enum: ["vegetable", "fruit", "plant protein", "animal protein", "dairy", "whole grain", "refined grain", "fat", "sweet", "drink", "other"] },
          whole: { type: "boolean" },
        },
      },
    },
  },
};

// Checks what the model returned before the app trusts it (same rules as server/reading.ts in the app repo).
const SIZES = ['small', 'regular', 'large']
const KINDS = ['vegetable', 'fruit', 'plant protein', 'animal protein', 'dairy', 'whole grain', 'refined grain', 'fat', 'sweet', 'drink', 'other']

// A plate of food is never zero or several kilos; a wild number would silently wreck the nutrition math.
const MIN_GRAMS = 5
const MAX_GRAMS = 1500

function normalizeReading(raw: unknown, placeIds: string[]): VisionResult {
  if (!raw || typeof raw !== 'object') throw new Error('bad-shape')
  const data = raw as Record<string, unknown>
  if (typeof data.food !== 'boolean' || !Array.isArray(data.items)) throw new Error('bad-shape')
  if (!data.food) return { food: false, meal: 'Your meal', place: null, items: [] }

  const seen = new Set<string>()
  const items: VisionItem[] = []
  for (const entry of data.items) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name.trim() : ''
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const grams = typeof e.grams === 'number' && Number.isFinite(e.grams) ? Math.min(MAX_GRAMS, Math.max(MIN_GRAMS, Math.round(e.grams))) : 100
    items.push({
      name,
      usda: typeof e.usda === 'string' && e.usda.trim() ? e.usda.trim() : name,
      grams,
      size: SIZES.includes(e.size as string) ? (e.size as VisionItem['size']) : 'regular',
      kind: KINDS.includes(e.kind as string) ? (e.kind as string) : 'other',
      whole: e.whole === true,
    })
  }
  if (!items.length) throw new Error('no-items')
  return {
    food: true,
    meal: typeof data.meal === 'string' && data.meal.trim() ? data.meal.trim() : 'Your meal',
    place: typeof data.place === 'string' && placeIds.includes(data.place) ? data.place : null,
    items: items.slice(0, 12),
  }
}

let client: Anthropic | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req: Request) => {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (req.method === "GET") return hasKey ? json({ ok: true }) : json({ ok: false, error: "no-key" }, 503);
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!hasKey) return json({ error: "no-key" }, 503);

  let body: { image?: unknown; place?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad-json" }, 400);
  }
  const image = typeof body.image === "string" ? body.image : "";
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(image);
  if (!match || image.length > MAX_IMAGE_CHARS) return json({ error: "bad-image" }, 400);
  const place = typeof body.place === "string" && PLACE_IDS.includes(body.place) ? body.place : null;

  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: match[1] as "image/jpeg", data: match[2] } },
            { type: "text", text: place ? `They said they're eating at ${PLACE_LABELS[place]} (id: ${place}).` : "They did not say where they are eating." },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return json({ error: "refusal" }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "truncated" }, 502);
    const text = response.content.find((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")?.text;
    if (!text) return json({ error: "empty" }, 502);
    const result: VisionResult = normalizeReading(JSON.parse(text), PLACE_IDS);
    return json(result);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: "claude", status: error.status }, 502);
    return json({ error: "unreadable" }, 502);
  }
};

export const config = { path: "/api/vision" };
