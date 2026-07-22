// Creates a Stripe Checkout session and returns its URL.
// The Stripe secret key is read from a Netlify environment variable
// (STRIPE_SECRET_KEY) — never hard-coded, never sent to the browser.

const Stripe = require("stripe");

// The two price IDs for Lapse's plans (test mode).
const PRICES = {
  monthly: "price_1TvmQkEFwQ3yMFnsfpThQVZ3", // £1 / month
  annual:  "price_1TvmSVEFwQ3yMFnscOAullhT"  // £9.99 / year
};

exports.handler = async function (event) {
  // Only accept POST
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

  const plan = data.plan === "annual" ? "annual" : "monthly";
  const price = PRICES[plan];
  const email = data.email || undefined;
  const userId = data.userId || "";
  // Where Stripe sends the user back to. The site origin is passed in
  // from the browser so this works on any domain.
  const origin = data.origin || "https://applapse.netlify.app";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: price, quantity: 1 }],
      customer_email: email,
      // Pass the Supabase user id through so the webhook can match the
      // payment back to the right account.
      client_reference_id: userId,
      metadata: { userId: userId, plan: plan },
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
