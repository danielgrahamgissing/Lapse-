// Daily reminder sweep.
//
// Runs on a schedule (see netlify.toml). For every contract, works out how
// many days until its end date. If that matches one of the reminders the
// user chose (30, 7 or 1), and we haven't already sent that exact reminder,
// emails them and logs it.
//
// Environment variables required (set in Netlify):
//   SUPABASE_URL           - your project URL
//   SUPABASE_SERVICE_KEY   - Supabase secret key (bypasses RLS so we can
//                            read every user's contracts)
//   RESEND_API_KEY         - your re_... key

const { createClient } = require("@supabase/supabase-js");

const FROM = "Lapse <reminders@lapsehq.com>";
const APP_URL = "https://lapsehq.com";

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function fmtMoney(pence) {
  if (pence === null || pence === undefined || isNaN(pence)) return null;
  return "£" + (pence / 100).toFixed(2);
}

/* Whole days between today (UTC midnight) and an end date. */
function daysUntil(endDate) {
  const today = new Date();
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const d = new Date(endDate);
  if (isNaN(d.getTime())) return null;
  const e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((e - t) / 86400000);
}

function buildEmail(contract, days) {
  const when = days === 1 ? "tomorrow" : "in " + days + " days";
  const cost = fmtMoney(contract.cost);
  const per = contract.occurrence === "monthly" ? " a month"
            : contract.occurrence === "yearly" ? " a year" : "";

  const rows = [];
  rows.push(["Ends", fmtDate(contract.end_date)]);
  if (contract.provider) rows.push(["Provider", contract.provider]);
  if (cost) rows.push(["Cost", cost + per]);
  if (contract.reference) rows.push(["Reference", contract.reference]);

  const table = rows.map(function (r) {
    return "<tr>"
      + "<td style=\"padding:7px 0;color:#6b8a8f;font-size:13px;width:110px\">" + esc(r[0]) + "</td>"
      + "<td style=\"padding:7px 0;color:#0E3A44;font-size:14px;font-weight:600\">" + esc(r[1]) + "</td>"
      + "</tr>";
  }).join("");

  const html =
      "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:8px\">"
    + "<p style=\"margin:0 0 4px;font-size:12px;color:#2E7D54;font-weight:700;"
    + "text-transform:uppercase;letter-spacing:.12em\">Lapse reminder</p>"
    + "<h1 style=\"margin:0 0 6px;font-family:Georgia,serif;font-size:23px;color:#0E3A44;line-height:1.25\">"
    + esc(contract.name) + " ends " + when + "</h1>"
    + "<p style=\"margin:0 0 18px;font-size:14px;color:#5b797e;line-height:1.55\">"
    + "You asked to be reminded " + days + (days === 1 ? " day" : " days") + " before this one runs out."
    + "</p>"
    + "<table style=\"width:100%;border-collapse:collapse;border-top:1px solid #dfeceb;"
    + "border-bottom:1px solid #dfeceb;margin-bottom:20px\">" + table + "</table>"
    + (contract.notes
        ? "<p style=\"margin:0 0 20px;font-size:13.5px;color:#0E3A44;line-height:1.6;"
          + "background:#f2f9f8;border-radius:10px;padding:13px 15px\">" + esc(contract.notes) + "</p>"
        : "")
    + "<a href=\"" + APP_URL + "\" style=\"display:inline-block;background:#2DBFC4;color:#04262D;"
    + "text-decoration:none;font-weight:700;font-size:14px;padding:13px 22px;border-radius:999px\">"
    + "Open Lapse</a>"
    + "<p style=\"margin:24px 0 0;font-size:11.5px;color:#8aa4a8;line-height:1.5\">"
    + "You're getting this because you set a reminder in Lapse. "
    + "Change or turn off reminders for this contract in the app.</p>"
    + "</div>";

  const text =
      contract.name + " ends " + when + "\n\n"
    + rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n")
    + (contract.notes ? "\n\nNotes: " + contract.notes : "")
    + "\n\nOpen Lapse: " + APP_URL;

  return {
    subject: contract.name + " ends " + when,
    html: html,
    text: text
  };
}

exports.handler = async function () {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supaUrl || !supaKey || !resendKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Not configured" }) };
  }

  const supabase = createClient(supaUrl, supaKey);
  const WINDOWS = [30, 7, 1];

  let checked = 0, sent = 0, skipped = 0, failed = 0;
  const problems = [];

  try {
    // Only look at contracts whose end date is within the next 31 days.
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 31);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const todayIso = new Date().toISOString().slice(0, 10);

    const { data: contracts, error } = await supabase
      .from("contracts")
      .select("*")
      .not("end_date", "is", null)
      .gte("end_date", todayIso)
      .lte("end_date", horizonIso);

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    for (const c of contracts || []) {
      checked++;
      const days = daysUntil(c.end_date);
      if (days === null || WINDOWS.indexOf(days) === -1) { skipped++; continue; }

      // Did the user ask for this reminder?
      const wants = Array.isArray(c.remind) ? c.remind : [30, 7, 1];
      if (wants.indexOf(days) === -1) { skipped++; continue; }

      // Already sent this exact reminder?
      const { data: already } = await supabase
        .from("reminders_sent")
        .select("id")
        .eq("contract_id", c.id)
        .eq("days_before", days)
        .eq("end_date", c.end_date)
        .limit(1);
      if (already && already.length) { skipped++; continue; }

      // Who is it going to?
      const { data: profile } = await supabase
        .from("profiles").select("email").eq("id", c.user_id).single();
      if (!profile || !profile.email) { skipped++; continue; }

      const mail = buildEmail(c, days);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + resendKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: FROM,
          to: [profile.email],
          subject: mail.subject,
          html: mail.html,
          text: mail.text
        })
      });

      if (!res.ok) {
        failed++;
        problems.push(c.name + ": " + (await res.text()).slice(0, 120));
        continue;                       // don't log it, so it retries tomorrow
      }

      // Record it so it can't send twice
      await supabase.from("reminders_sent").insert({
        contract_id: c.id,
        user_id: c.user_id,
        days_before: days,
        end_date: c.end_date
      });
      sent++;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, checked, sent, skipped, failed, problems })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Sweep failed", checked, sent, failed })
    };
  }
};
