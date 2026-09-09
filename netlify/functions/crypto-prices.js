// Fetches current prices for a list of tokens from CoinGecko's free API.
// The app sends CoinGecko ids (e.g. "bitcoin","ethereum"), this returns
// { bitcoin: { gbp: 51234.12 }, ethereum: { gbp: 2765.40 }, ... }.
//
// No API key needed for this endpoint. Kept server-side so: the app
// never depends on CoinGecko's CORS policy, requests can be cached, and
// if a key is ever needed later it stays out of the browser.

exports.handler = async function (event) {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  var ids = [];
  if (event.httpMethod === "GET") {
    var q = (event.queryStringParameters && event.queryStringParameters.ids) || "";
    ids = q.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  } else {
    try {
      var data = JSON.parse(event.body || "{}");
      ids = Array.isArray(data.ids) ? data.ids : [];
    } catch (e) {}
  }

  // keep it small and sane
  ids = ids.filter(function (s) { return /^[a-z0-9-]{1,60}$/.test(s); }).slice(0, 60);
  if (!ids.length) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({})
    };
  }

  var url = "https://api.coingecko.com/api/v3/simple/price?ids="
    + encodeURIComponent(ids.join(",")) + "&vs_currencies=gbp";

  try {
    var res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Price service unavailable" })
      };
    }
    var prices = await res.json();
    return {
      statusCode: 200,
      // cache briefly at the edge so rapid page loads don't hammer CoinGecko
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=45" },
      body: JSON.stringify(prices)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not reach price service" })
    };
  }
};
