// Permanently deletes a user account: cancels their Stripe subscription,
// removes their stored files, wipes their data, and deletes the auth user.
//
// Called by the app with the signed-in user's access token. We verify that
// token server-side, so a user can only ever delete their OWN account.
//
// Environment variables required (already set in Netlify):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, STRIPE_SECRET_KEY

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!supaUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Not configured" }) };
  }

  // The app sends the user's access token; we use it to find out who they
  // are. This is what stops one user deleting another's account.
  let token = "";
  try {
    const auth = event.headers.authorization || event.headers.Authorization || "";
    token = auth.replace(/^Bearer\s+/i, "");
  } catch (e) {}
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };
  }

  const admin = createClient(supaUrl, serviceKey);

  // Verify the token and get the user id.
  let userId, userEmail;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
    }
    userId = data.user.id;
    userEmail = data.user.email;
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: "Could not verify session" }) };
  }

  const report = { stripe: "skipped", files: 0, data: false, auth: false };

  try {
    // 1. Cancel the Stripe subscription, if any.
    if (stripeKey) {
      try {
        const stripe = Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const { data: prof } = await admin
          .from("profiles").select("stripe_customer_id").eq("id", userId).single();
        const customerId = prof && prof.stripe_customer_id;
        if (customerId) {
          const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
          for (const s of (subs.data || [])) {
            if (s.status !== "canceled") {
              await stripe.subscriptions.cancel(s.id);
            }
          }
          report.stripe = "cancelled";
        } else {
          report.stripe = "no-customer";
        }
      } catch (e) {
        report.stripe = "error: " + (e.message || "unknown");
        // don't abort — we still want to delete the account
      }
    }

    // 2. Remove stored files (contract attachments + expense receipts).
    try {
      const paths = [];
      const { data: cf } = await admin.from("contract_files").select("path").eq("user_id", userId);
      (cf || []).forEach(function (r) { if (r.path) paths.push(r.path); });
      const { data: exps } = await admin.from("expenses").select("receipts").eq("user_id", userId);
      (exps || []).forEach(function (e) {
        (Array.isArray(e.receipts) ? e.receipts : []).forEach(function (r) {
          if (r && r.path) paths.push(r.path);
        });
      });
      if (paths.length) {
        await admin.storage.from("contract-files").remove(paths);
        report.files = paths.length;
      }
    } catch (e) { /* best-effort */ }

    // 3. Delete their rows. Foreign keys cascade from auth.users, but we
    //    clear the main tables explicitly too, in case cascade isn't set.
    try {
      await admin.from("contracts").delete().eq("user_id", userId);
      await admin.from("expenses").delete().eq("user_id", userId);
      await admin.from("contract_files").delete().eq("user_id", userId);
      await admin.from("reminders_sent").delete().eq("user_id", userId);
      await admin.from("profiles").delete().eq("id", userId);
      report.data = true;
    } catch (e) {
      report.data = "error: " + (e.message || "unknown");
    }

    // 4. Delete the auth user — this frees the email for re-signup.
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      report.auth = !error;
      if (error) report.auth = "error: " + error.message;
    } catch (e) {
      report.auth = "error: " + (e.message || "unknown");
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, report: report })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Deletion failed", report: report })
    };
  }
};
