// Creates a Stripe Checkout session and returns its URL.
// The Stripe secret key is read from a Netlify environment variable
// (STRIPE_SECRET_KEY) — never hard-coded, never sent to the browser.

const Stripe = require("stripe");

// Single monthly plan: £1.99/month.
// Replace the value below with the price_... id of your £1.99 monthly
// price from Stripe (Product catalogue -> your product -> the £1.99 price).
const PRICE_MONTHLY = "REPLACE_WITH_NEW_PRICE_ID";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server not configured" }) };
  }

  const stripe = Stripe(key, { apiVersion: "2025-03-31.basil" });

  let data = {};
  try { data = JSON.parse(event.body || "{}"); } catch (e) {}

  const email = data.email || undefined;
  const userId = data.userId || "";
  const origin = data.origin || "https://lapsehq.com";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: PRICE_MONTHLY, quantity: 1 }],
      customer_email: email,
      client_reference_id: userId,
      metadata: { userId: userId, plan: "monthly" },
      success_url: origin + "/?paid=1",
      cancel_url: origin + "/?canceled=1"
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Stripe error" })
    };
  }
};
