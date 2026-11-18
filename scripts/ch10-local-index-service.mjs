import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const catalogBytes = readFileSync(new URL("../data/nyc-poi-v1.json", import.meta.url));
const catalog = JSON.parse(catalogBytes);
const published = catalog.filter((place) => place.published);
const allIds = published.map((place) => place.id);
const catalogSha256 = createHash("sha256").update(catalogBytes).digest("hex");
const byInterest = new Map();

for (const place of published) {
  for (const interest of place.interests) {
    if (!byInterest.has(interest)) byInterest.set(interest, new Set());
    byInterest.get(interest).add(place.id);
  }
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health")
    return send(response, 200, { dataVersionId: "nyc-poi-v1", catalogSha256, catalogCount: published.length });
  if (request.method !== "POST" || request.url !== "/query")
    return send(response, 404, { error: "not_found" });

  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const { cityCode, interests, intentText, dining } = JSON.parse(raw);
    if (cityCode !== "nyc" || !Array.isArray(interests) || typeof intentText !== "string" || typeof dining !== "string")
      return send(response, 400, { error: "invalid_request" });

    // Free text and dining can match places beyond interest chips; retain the full pool for those requests.
    const indexed = !intentText.trim() && dining === "no_preference" && interests.length > 0;
    const selected = indexed ? new Set(interests.flatMap((interest) => [...(byInterest.get(interest) ?? [])])) : null;
    const ids = selected ? allIds.filter((id) => selected.has(id)) : allIds;
    return send(response, 200, { dataVersionId: "nyc-poi-v1", catalogSha256, catalogCount: published.length, indexed, ids });
  } catch {
    return send(response, 400, { error: "invalid_json" });
  }
}).listen(3333, "127.0.0.1", () => console.info(`Chapter 10 local index ready on http://127.0.0.1:3333 (${published.length} places)`));
