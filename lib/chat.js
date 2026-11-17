"use strict";

const STOP_WORDS = new Set([
  "the","and","for","with","have","what","your","you","are","can","how","does","did","this","that",
  "from","about","show","need","want","please","would","could","any","some","under","below","less",
  "than","best","good","much","cost","price","buy","get","looking","look","give","tell","help","shop",
  "store","mosey","item","items","product","products","something","anything","which","there","their",
  "them","its","was","were","will","just","also","more","most","very","but","not","our","out","all"
]);

const money = (n) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 })
    .format(Number(n) || 0);

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function scoreProduct(product, words) {
  const name = String(product.name || "").toLowerCase();
  const haystack = `${name} ${product.description || ""} ${product.category || ""}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (!haystack.includes(word)) continue;
    score += name.includes(word) ? 3 : 1;
  }
  return score;
}

function budgetOf(text) {
  const match = String(text).match(
    /(?:under|below|less than|up to|upto|max(?:imum)?|budget(?: of)?|around)\s*(?:kes|ksh|sh)?\s*([\d,]+)/i
  );
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function categoriesFor(text) {
  const value = String(text).toLowerCase();
  const cats = new Set();
  if (/\b(tech|electronic|electronics|gadget|gadgets|headphone|headphones|watch|smartwatch|charger|device)\b/.test(value)) cats.add("Electronics");
  if (/\b(style|fashion|clothes|clothing|bag|bags|backpack|shoe|shoes|sneaker|sneakers|wear|accessor(?:y|ies))\b/.test(value)) cats.add("Fashion");
  if (/\b(home|decor|lamp|lamps|kitchen|coffee|ceramic|furniture|desk|office)\b/.test(value)) cats.add("Home");
  return [...cats];
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    stock: product.stock,
    image: product.image
  };
}

function pickProducts(message, products) {
  const text = String(message).toLowerCase();
  const categories = categoriesFor(text);
  const budget = budgetOf(text);
  const words = tokens(text);
  let rows = products.filter(
    (product) => (!categories.length || categories.includes(product.category)) && (!budget || product.price <= budget)
  );
  const scored = rows
    .map((product) => ({ product, score: scoreProduct(product, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price);
  if (scored.length) rows = scored.map((entry) => entry.product);
  return { rows, categories, budget, words, matched: scored.length > 0 };
}

function detailReply(product) {
  const stock = product.stock > 0 ? `${product.stock} in stock` : "currently out of stock";
  return {
    reply: `${product.name} is ${money(product.price)} (${product.category}) and ${stock}.\n${product.description || "A great everyday pick."}`,
    products: [publicProduct(product)],
    intent: "product"
  };
}

function listReply(rows, intro) {
  if (!rows.length) {
    return {
      reply: "I couldn't find a match for that. Try another category or a higher budget — or tell me what you need it for.",
      products: [],
      intent: "product"
    };
  }
  return {
    reply: `${intro} Tap “Add” on a product to put it straight in your bag.`,
    products: rows.slice(0, 3).map(publicProduct),
    intent: "product"
  };
}

function featured(products, count = 2) {
  const picks = products.filter((product) => product.featured && product.stock > 0);
  return (picks.length ? picks : products.filter((product) => product.stock > 0)).slice(0, count).map(publicProduct);
}

function localReply(message, products) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();

  if (!products.length) {
    return {
      reply: "The catalogue is empty right now, so I can't recommend anything yet. Please check back shortly.",
      products: [],
      intent: "general"
    };
  }

  if (/^(hi|hello|hey|habari|jambo|good (morning|afternoon|evening))\b/.test(lower)) {
    return {
      reply: "Hi! I'm Mosey, your shopping assistant. I can help you find products, check prices and stock, or explain delivery and payment. What are you looking for?",
      products: featured(products, 2),
      intent: "greeting"
    };
  }

  if (/\b(thanks|thank you|asante|sawa)\b/.test(lower)) {
    return {
      reply: "You're welcome! If you need anything else — products, delivery or your order — I'm here.",
      products: [],
      intent: "thanks"
    };
  }

  if (/\b(track|tracking|where is my order|order status|my order|order number|delivery status)\b/.test(lower)) {
    return {
      reply: "To check an order, sign in and open your account menu, then choose “My orders”. You'll see the status, items and total for each order. If you checked out as a guest, place future orders while signed in so they appear there.",
      products: [],
      intent: "orders"
    };
  }

  if (/\b(return|returns|refund|exchange|warranty)\b/.test(lower)) {
    return {
      reply: "Returns aren't automated yet. Please contact the store before sending anything back, and keep your order number handy. For damaged or wrong items, report it as soon as your order arrives.",
      products: [],
      intent: "returns"
    };
  }

  if (/\b(deliver|delivery|shipping|ship|courier|how long|arrive|arrives)\b/.test(lower)) {
    return {
      reply: "Delivery is arranged after checkout and the store confirms the cost before fulfilment. Times depend on your location, so the store will follow up with the details. Your order will show as Pending until it's processed.",
      products: [],
      intent: "delivery"
    };
  }

  if (/\b(whatsapp|wa\.me|chat on whatsapp|message you)\b/.test(lower)) {
    return {
      reply: "You can reach Mosey Shop on WhatsApp at 0793 489 901 (+254 793 489 901). Open the WhatsApp page to send your items, confirm delivery and share your M-Pesa payment code. Tap WhatsApp in the menu or go to whatsapp.html.",
      products: [],
      intent: "whatsapp"
    };
  }

  if (/\b(pay|payment|paying|mpesa|m-pesa|cash|bank|card|checkout)\b/.test(lower)) {
    return {
      reply: "You can pay by M-Pesa Send Money to 0793 489 901, or choose cash on delivery, M-Pesa on delivery, or bank transfer at checkout. The quickest way to confirm an order is the WhatsApp page: send your items and delivery details, then share the M-Pesa confirmation code on WhatsApp. WhatsApp never asks for your M-Pesa PIN.",
      products: [],
      intent: "payment"
    };
  }

  if (/\b(human|agent|support|contact|email|phone|call|complaint)\b/.test(lower)) {
    return {
      reply: "For account-specific issues, sign in and open “My orders”, or message the store on WhatsApp at 0793 489 901. I can help with products, prices, stock, delivery and payment questions, but I can't access payment details or change orders for you.",
      products: [],
      intent: "support"
    };
  }

  const picks = pickProducts(text, products);
  const browse = /\b(show|browse|see|list|options|collection|range|what|which|looking for|any)\b/.test(lower);
  const direct = /\b(how much|price|cost|stock|available|do you have|is there)\b/.test(lower);

  if (/\b(cheap|cheapest|affordable|budget-friendly|lowest price)\b/.test(lower) && !picks.budget) {
    const rows = products.filter((product) => product.stock > 0).sort((a, b) => a.price - b.price);
    return listReply(rows, "Here are the most affordable picks right now.");
  }

  if (/\b(premium|expensive|highest price|luxury)\b/.test(lower) && !picks.budget) {
    const rows = products.filter((product) => product.stock > 0).sort((a, b) => b.price - a.price);
    return listReply(rows, "Here are the premium picks in the shop.");
  }

  if (picks.matched && (direct || picks.rows.length === 1) && !picks.budget) {
    return detailReply(picks.rows[0]);
  }

  if (picks.budget) {
    const rows = picks.rows.slice().sort((a, b) => a.price - b.price);
    const intro = rows.length
      ? `Here's what I found under ${money(picks.budget)}${picks.categories.length ? ` in ${picks.categories.join(" and ")}` : ""}.`
      : `I couldn't find anything under ${money(picks.budget)}${picks.categories.length ? ` in ${picks.categories.join(" and ")}` : ""}.`;
    return listReply(rows, intro);
  }

  if (picks.matched && (browse || picks.rows.length > 1)) {
    return listReply(picks.rows, "Here are some good matches.");
  }

  if (picks.categories.length) {
    const rows = products.filter((product) => picks.categories.includes(product.category));
    return listReply(rows, `Here's what's in ${picks.categories.join(" and ")} right now.`);
  }

  if (/\b(catalog|catalogue|what do you sell|everything|all products|all items|your products|inventory)\b/.test(lower)) {
    const counts = products.reduce((acc, product) => {
      acc[product.category] = (acc[product.category] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([category, count]) => `${category} (${count})`).join(", ");
    return {
      reply: `The shop currently has ${products.length} products across ${summary}. Browse the full collection on the Shop page, or tell me a category or budget and I'll narrow it down.`,
      products: featured(products, 3),
      intent: "catalogue"
    };
  }

  if (picks.matched) {
    return detailReply(picks.rows[0]);
  }

  return {
    reply: "I can help you find products, check prices and stock, or explain delivery and payment. Try “Show me tech”, “Gift under KES 2,000”, or “How does delivery work?”.",
    products: featured(products, 2),
    intent: "fallback"
  };
}

function buildCatalogue(products) {
  return products
    .map(
      (product) =>
        `#${product.id} | ${product.name} | ${product.category} | ${money(product.price)} | ${product.stock} in stock | ${product.description || "No description"}`
    )
    .join("\n");
}

async function openAiReply(message, history, products) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS) || 20000;

  const system = [
    "You are Mosey, the friendly shopping assistant for Mosey Shop, a Kenyan online store. Prices are in Kenyan shillings (KES).",
    "Use ONLY the catalogue below for product facts. Never invent products, prices, stock, delivery times or policies.",
    "Store facts:",
    "- Payments: M-Pesa Send Money to 0793 489 901 (Mosey Shop); cash on delivery, M-Pesa on delivery and bank transfer are also available at checkout.",
    "- WhatsApp ordering: customers can confirm orders and share payment codes on WhatsApp at 0793 489 901, or by opening whatsapp.html. WhatsApp never asks for an M-Pesa PIN.",
    "- Delivery costs are confirmed by the store after checkout.",
    "- Returns are not automated; customers should contact the store before sending items back.",
    "- Order tracking: customers sign in, open the account menu, then choose My orders.",
    "- Administrator tools are private.",
    "Style: warm and concise, 2-4 sentences maximum, plain text (no markdown tables or headings). Never ask for passwords, card numbers or other sensitive data.",
    "",
    "Catalogue:",
    buildCatalogue(products)
  ].join("\n");

  const safeHistory = history.map((entry) => ({ role: entry.role, content: entry.content }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 320,
        messages: [{ role: "system", content: system }, ...safeHistory, { role: "user", content: message }]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Provider responded ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
    }
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("Provider returned an empty reply.");
    return reply.trim();
  } finally {
    clearTimeout(timer);
  }
}

function createChatHandler({ db }) {
  return async function chatHandler(req, res) {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Type a message so I can help." });
    if (message.length > 500) return res.status(400).json({ error: "Please keep messages under 500 characters." });

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history = rawHistory
      .filter((entry) => entry && ["user", "assistant"].includes(entry.role) && typeof entry.content === "string")
      .slice(-8)
      .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 500) }));

    const products = db
      .prepare("SELECT id,name,description,category,price,stock,image,featured FROM products ORDER BY featured DESC, id DESC")
      .all();

    const local = localReply(message, products);
    let reply = local.reply;
    let source = "local";

    if (process.env.OPENAI_API_KEY) {
      try {
        const aiReply = await openAiReply(message, history, products);
        if (aiReply) {
          reply = aiReply;
          source = "ai";
        }
      } catch (error) {
        console.warn(`[chat] AI provider unavailable, using local replies: ${error.message}`);
      }
    }

    res.json({ reply, products: local.products.slice(0, 3), source });
  };
}

module.exports = { createChatHandler, localReply };
