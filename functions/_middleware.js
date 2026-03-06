export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return response;
  }

  const adsenseClient = context.env.ADSENSE_CLIENT || "ca-pub-REPLACE_ME";
  const adsenseSlot = context.env.ADSENSE_SLOT || "REPLACE_ME";
  const formspreeEndpoint = context.env.FORMSPREE_ENDPOINT || "#";

  let html = await response.text();
  html = html.replaceAll("__ADSENSE_CLIENT__", adsenseClient);
  html = html.replaceAll("__ADSENSE_SLOT__", adsenseSlot);
  html = html.replaceAll("__FORMSPREE_ENDPOINT__", formspreeEndpoint);

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
