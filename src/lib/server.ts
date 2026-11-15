import type { Backend } from "./backend.js";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { timingSafeEqual, randomBytes } from "node:crypto";
const ROOT = path.resolve(__dirname, "../../www");
const equal = (a: string, b: string) => {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};
async function body(
  req: http.IncomingMessage,
): Promise<import("./types.js").ProtocolMessage> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024)
      throw Object.assign(new Error("Datei zu groß (max. 20 MiB)."), {
        status: 413,
      });
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}
function createServer(backend: Backend, token: string) {
  if (typeof token !== "string" || token.length < 16)
    throw new Error(
      "Bitte einen Zugangsschlüssel mit mindestens 16 Zeichen konfigurieren.",
    );
  const sessions = new Map<string, number>(),
    attempts = new Map<string, { count: number; until: number }>();
  return http.createServer(async (req, res) => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "POST") {
        // Fetch's custom content type prevents cross-origin form posts; Origin also guards same-site siblings.
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          return json(415, { message: "JSON required" });
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          return json(403, { message: "Fremder Ursprung abgelehnt." });
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "unknown",
          now = Date.now(),
          attempt = attempts.get(ip);
        if (attempt && attempt.until > now && attempt.count >= 10)
          return json(429, {
            message:
              "Zu viele Versuche. Bitte in einer Minute erneut versuchen.",
          });
        const input = await body(req);
        if (!equal(String(input.token || ""), token)) {
          attempts.set(ip, {
            count: attempt && attempt.until > now ? attempt.count + 1 : 1,
            until: now + 60000,
          });
          return json(401, { message: "Zugangsschlüssel ungültig." });
        }
        attempts.delete(ip);
        for (const [key, expiry] of sessions)
          if (expiry < now) sessions.delete(key);
        const session = randomBytes(32).toString("hex");
        sessions.set(session, now + 86400000);
        res.setHeader(
          "Set-Cookie",
          `np_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        );
        return json(200, { ok: true });
      }
      if (url.pathname.startsWith("/api/")) {
        const session = /(?:^|;\s*)np_session=([a-f0-9]+)/.exec(
          req.headers.cookie || "",
        )?.[1];
        if (!((sessions.get(session || "") || 0) > Date.now()))
          return json(401, { message: "Bitte anmelden." });
        if (url.pathname === "/api/bootstrap" && req.method === "GET")
          return json(200, await backend.bootstrap());
        if (url.pathname === "/api/call" && req.method === "POST")
          return json(200, await backend.call(await body(req)));
        return json(404, { message: "Unbekannte API." });
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(405, { message: "Method not allowed" });
      const name = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      const file = path.resolve(ROOT, "." + name);
      if (!file.startsWith(ROOT + path.sep))
        return json(403, { message: "Forbidden" });
      const content = await fs.readFile(file);
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css",
        ".json": "application/json",
        ".woff2": "font/woff2",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (e) {
      json(e.status || (e.code === "ENOENT" ? 404 : 400), {
        code: e.code || "request_failed",
        message: e.message,
      });
    }
  });
}
export { createServer };
