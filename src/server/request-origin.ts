export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  // Next's internal Request URL can use its listen hostname. The public Host
  // header identifies the origin used by the browser. Vercel terminates TLS.
  const host = request.headers.get("Host");
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return url.origin;
  try {
    return new URL((process.env.VERCEL === "1" ? "https:" : url.protocol) + "//" + host).origin;
  } catch {
    return url.origin;
  }
}
