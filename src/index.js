import { createRemoteJWKSet, jwtVerify } from "jose";

const json = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function isAdmin(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  try {
    const issuer = env.ACCESS_TEAM_DOMAIN.startsWith("https://") ? env.ACCESS_TEAM_DOMAIN : "https://" + env.ACCESS_TEAM_DOMAIN;
    const jwks = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    if (!payload.email) return false;
    if (env.ADMIN_EMAIL && String(payload.email).toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return false;
    return true;
  } catch { return false; }
}

async function loadContent(env, assets) {
  const row = await env.DB.prepare("SELECT content FROM site_content WHERE id = 1").first();
  if (row?.content) {
    try { return JSON.parse(row.content); } catch {}
  }
  const response = await assets.fetch(new Request(new URL("/site-data.json", "https://assets.local")));
  if (!response.ok) throw new Error("Initial site content is missing");
  const initial = await response.json();
  await env.DB.prepare("INSERT OR IGNORE INTO site_content (id, content, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)")
    .bind(JSON.stringify(initial)).run();
  return initial;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/content" && request.method === "GET") {
      try { return json(await loadContent(env, env.ASSETS)); }
      catch (e) { return json({ error: "Content unavailable" }, 500); }
    }
    if (url.pathname.startsWith("/api/admin/")) {
      if (!(await isAdmin(request, env))) return json({ error: "Not authorised. Sign in through Cloudflare Access." }, 401);
      if (url.pathname === "/api/admin/me" && request.method === "GET") return json({ authenticated: true });
      if (url.pathname === "/api/admin/content" && request.method === "PUT") {
        let data;
        try { data = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.name !== "string" || !Array.isArray(data.work)) {
          return json({ error: "The site data format is invalid." }, 400);
        }
        const serialized = JSON.stringify(data);
        if (serialized.length > 500000) return json({ error: "Content is too large." }, 413);
        await env.DB.prepare("INSERT INTO site_content (id, content, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP")
          .bind(serialized).run();
        return json({ saved: true });
      }
      if (url.pathname === "/api/admin/upload" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.type.startsWith("image/")) return json({ error: "Choose an image file." }, 400);
        if (file.size > 10 * 1024 * 1024) return json({ error: "Images must be 10 MB or smaller." }, 413);
        const ext = (file.type.split("/")[1] || "img").replace(/[^a-z0-9]/gi, "").slice(0,8) || "img";
        const key = crypto.randomUUID() + "." + ext;
        await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
        return json({ url: "/media/" + key });
      }
      return json({ error: "Not found" }, 404);
    }
    if (url.pathname.startsWith("/media/") && request.method === "GET") {
      const key = url.pathname.slice(7);
      if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
      const object = await env.MEDIA.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      return new Response(object.body, { headers });
    }
    return env.ASSETS.fetch(request);
  }
};
