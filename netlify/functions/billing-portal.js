// Creates a Stripe Billing Portal session and returns its URL.
// The portal is hosted by Stripe: the user can update their card, view
// invoices, and cancel — all securely, with no card forms in our app.
//
// Verifies the user's Supabase token so we only ever open the portal for
// that user's own Stripe customer.
//
// Environment variables (already set in Netlify):
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!stripeKey || !supaUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Not configured" }) };
  }

  // Identify the caller from their access token.
  let token = "";
  try {
    const auth = event.headers.authorization || event.headers.Authorization || "";
    token = auth.replace(/^Bearer\s+/i, "");
  } catch (e) {}
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };

  const admin = createClient(supaUrl, serviceKey);

  let userId;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
    }
    userId = data.user.id;
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: "Could not verify session" }) };
  }

  let data = {};
  try { data = JSON.parse(event.body || "{}"); } catch (e) {}
  const origin = data.origin || "https://lapsehq.com";

  try {
    const { data: prof } = await admin
      .from("profiles").select("stripe_customer_id").eq("id", userId).single();
    const customerId = prof && prof.stripe_customer_id;
    if (!customerId) {
      return { statusCode: 400, body: JSON.stringify({ error: "No billing account found" }) };
    }

    const stripe = Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: origin + "/?billing=done"
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
