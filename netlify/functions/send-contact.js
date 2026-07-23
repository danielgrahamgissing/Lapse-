// Sends a message from the app's contact form to the Lapse inbox via Resend.
//
// The clever bit: reply_to is set to the CUSTOMER's address, so hitting
// Reply in your inbox goes straight back to them — no Resend needed.
//
// Environment variable required (set in Netlify):
//   RESEND_API_KEY - your re_... key

const INBOX = "lapsecustomer@outlook.com";
const FROM = "Lapse <contact@lapsehq.com>";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Email not configured" })
    };
  }

  let data = {};
  try { data = JSON.parse(event.body || "{}"); } catch (e) {}

  const from    = (data.email   || "").trim();
  const subject = (data.subject || "").trim();
  const message = (data.message || "").trim();

  // Basic validation
  if (!from || from.indexOf("@") < 1) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ error: "A valid email address is required" }) };
  }
  if (!subject || !message) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ error: "Subject and message are required" }) };
  }
  if (message.length > 5000 || subject.length > 200) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ error: "Message is too long" }) };
  }

  // Escape anything the user typed before putting it in HTML
  function esc(s) {
    return String(s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  const html =
      "<div style=\"font-family:Arial,Helvetica,sans-serif;color:#0E3A44;line-height:1.6\">"
    + "<p style=\"margin:0 0 14px;font-size:13px;color:#2E7D54;font-weight:700;"
    + "text-transform:uppercase;letter-spacing:.1em\">New message via Lapse</p>"
    + "<p style=\"margin:0 0 6px\"><b>From:</b> " + esc(from) + "</p>"
    + "<p style=\"margin:0 0 16px\"><b>Subject:</b> " + esc(subject) + "</p>"
    + "<div style=\"border-top:1px solid #d7e6e4;padding-top:16px;white-space:pre-wrap\">"
    + esc(message) + "</div>"
    + "<p style=\"margin:22px 0 0;font-size:12px;color:#6b8a8f\">"
    + "Reply to this email and it will go straight back to the customer.</p>"
    + "</div>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM,
        to: [INBOX],
        reply_to: from,              // replying reaches the customer
        subject: "Lapse enquiry: " + subject,
        html: html,
        text: "From: " + from + "\nSubject: " + subject + "\n\n" + message
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      return { statusCode: 502, headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ error: "Could not send message", detail: detail.slice(0, 200) }) };
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ error: err.message || "Send failed" }) };
  }
};
