// Stripe calls this after events (payment completed, subscription
// canceled, etc.). We verify the call is really from Stripe, then update
// the user's subscription status in Supabase.
//
// Environment variables required (set in Netlify):
//   STRIPE_SECRET_KEY        - your sk_test_... key
//   STRIPE_WEBHOOK_SECRET    - the whsec_... signing secret from Stripe
//   SUPABASE_URL             - your project URL
//   SUPABASE_SERVICE_KEY     - the Supabase SECRET (service_role) key

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  const key = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = Stripe(key, { apiVersion: "2025-03-31.basil" });

  let stripeEvent;
  try {
    const sig = event.headers["stripe-signature"];
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, whSecret);
  } catch (err) {
    return { statusCode: 400, body: "Webhook signature verification failed: " + err.message };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  async function setSubscribed(userId, subscribed, plan, periodEnd) {
    if (!userId) return;
    await supabase.from("profiles").update({
      subscribed: subscribed,
      plan: plan || null,
      current_period_end: periodEnd || null
    }).eq("id", userId);
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const userId = session.client_reference_id || (session.metadata && session.metadata.userId);
      const plan = session.metadata && session.metadata.plan;
      // Fetch the subscription to get the period end
      let periodEnd = null;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        if (sub && sub.current_period_end) {
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        }
        // Save the Stripe customer id for later management
        if (userId && sub.customer) {
          await supabase.from("profiles").update({ stripe_customer_id: sub.customer }).eq("id", userId);
        }
      }
      await setSubscribed(userId, true, plan, periodEnd);
    }

    if (stripeEvent.type === "customer.subscription.deleted") {
      const sub = stripeEvent.data.object;
      // Find the profile by stripe_customer_id and mark unsubscribed
      const { data: rows } = await supabase.from("profiles")
        .select("id").eq("stripe_customer_id", sub.customer).limit(1);
      if (rows && rows[0]) {
        await setSubscribed(rows[0].id, false, "free", null);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    return { statusCode: 500, body: "Handler error: " + (err.message || "unknown") };
  }
};
