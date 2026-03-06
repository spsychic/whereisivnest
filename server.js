const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);

loadEnv(path.join(ROOT, ".env"));

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "";
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || "ca-pub-REPLACE_ME";
const ADSENSE_SLOT = process.env.ADSENSE_SLOT || "REPLACE_ME";
const PORTFOLIO_LIMIT = Number(process.env.PORTFOLIO_LIMIT || 120);
const METRICS_LOG_INTERVAL_MS = 10 * 60_000;
const PRICES_CACHE_TTL_MS = 60_000;
const NEWS_CACHE_TTL_MS = 10 * 60_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const metrics = {
  priceYahoo: { attempts: 0, successes: 0, failures: 0 },
  priceNaver: { attempts: 0, successes: 0, failures: 0 },
  newsGoogle: { attempts: 0, successes: 0, failures: 0 },
  newsNaver: { attempts: 0, successes: 0, failures: 0 },
};

const apiCache = {
  prices: { value: null, expiresAt: 0, pending: null },
  news: { value: null, expiresAt: 0, pending: null },
};

function markMetricAttempt(name) {
  const target = metrics[name];
  if (!target) return;
  target.attempts += 1;
}

function markMetricResult(name, ok) {
  const target = metrics[name];
  if (!target) return;
  if (ok) target.successes += 1;
  else target.failures += 1;
}

function metricFailureRate(item) {
  if (!item.attempts) return "0.00";
  return ((item.failures / item.attempts) * 100).toFixed(2);
}

function logMetricsSummary(context = "periodic") {
  const pairs = Object.entries(metrics).map(([name, item]) => {
    return (
      `${name}(attempts=${item.attempts},success=${item.successes},` +
      `fail=${item.failures},failRate=${metricFailureRate(item)}%)`
    );
  });
  console.log(`[METRIC][${context}] ${pairs.join(" | ")}`);
}

function loadEnv(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env 파일이 없어도 서버는 동작합니다.
  }
}

function buildDefaultHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self' https: data: blob: 'unsafe-inline';",
    ...extra,
  };
}

function sendJson(res, code, payload, headers = {}) {
  res.writeHead(
    code,
    buildDefaultHeaders({
      "Content-Type": MIME_TYPES[".json"],
      "Cache-Control": "no-store",
      ...headers,
    }),
  );
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, status, code, message, details = null) {
  sendJson(res, status, {
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
  });
}

async function getCachedResource(key, ttlMs, loader) {
  const cache = apiCache[key];
  if (!cache) return loader();

  if (cache.value && Date.now() < cache.expiresAt) {
    return cache.value;
  }
  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = (async () => {
    const value = await loader();
    cache.value = value;
    cache.expiresAt = Date.now() + ttlMs;
    return value;
  })().finally(() => {
    cache.pending = null;
  });

  return cache.pending;
}

function safeHtmlDecode(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, "").trim();
}

function tickerToYahooSymbol(ticker) {
  if (ticker.endsWith(".KS") || ticker.endsWith(".KQ")) return ticker;
  if (/^\d{6}$/.test(ticker)) return `${ticker}.KS`;
  return ticker;
}

function tickerToKrxCode(ticker) {
  const match = tickerToYahooSymbol(ticker).match(/^(\d{6})\.(KS|KQ)$/);
  return match ? match[1] : "";
}

function startOfDayUnix(dateStr) {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  return Math.floor(date.getTime() / 1000);
}

async function readPortfolioConfig() {
  const raw = await fsp.readFile(path.join(ROOT, "data", "portfolio.json"), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.holdings)) {
    throw new Error("invalid portfolio format");
  }
  return parsed.holdings;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${url}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${url}`);
  }
  return response.text();
}

async function fetchCurrentPrices(tickers) {
  const out = {};
  const normalized = tickers.map(tickerToYahooSymbol);
  const chunkSize = 100;

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const symbols = normalized.slice(i, i + chunkSize).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
    markMetricAttempt("priceYahoo");
    try {
      const data = await fetchJson(url);
      for (const item of data.quoteResponse?.result || []) {
        const symbol = item.symbol;
        const value = item.regularMarketPrice;
        if (symbol && typeof value === "number") {
          out[symbol] = value;
        }
      }
      markMetricResult("priceYahoo", true);
    } catch {
      markMetricResult("priceYahoo", false);
      // Continue best-effort even if one chunk request fails.
    }
  }

  const missing = normalized.filter((symbol) => typeof out[symbol] !== "number");
  if (missing.length) {
    const naverPrices = await fetchNaverPricesForTickers(missing);
    Object.assign(out, naverPrices);
  }
  return out;
}

async function fetchNaverPricesForTickers(tickers) {
  const symbols = tickers.map(tickerToYahooSymbol);
  const byCode = new Map();
  for (const symbol of symbols) {
    const code = tickerToKrxCode(symbol);
    if (code) byCode.set(code, symbol);
  }

  const prices = {};
  const codes = [...byCode.keys()];
  const chunkSize = 50;
  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const query = `SERVICE_ITEM:${chunk.join(",")}`;
    const url =
      `https://polling.finance.naver.com/api/realtime?query=${encodeURIComponent(query)}` +
      "&src=web";
    markMetricAttempt("priceNaver");

    try {
      const data = await fetchJson(url);
      const rows = data.result?.areas?.[0]?.datas || [];
      for (const row of rows) {
        const code = String(row.cd || "");
        const symbol = byCode.get(code);
        const value = Number(row.nv);
        if (symbol && Number.isFinite(value) && value > 0) {
          prices[symbol] = value;
        }
      }
      markMetricResult("priceNaver", true);
    } catch {
      markMetricResult("priceNaver", false);
      // Naver fallback is best-effort.
    }
  }
  return prices;
}

async function fetchHistoricalClose(symbol, snapshotDate) {
  const period1 = startOfDayUnix(snapshotDate) - 86400;
  const period2 = startOfDayUnix(snapshotDate) + 86400 * 2;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;

  try {
    const data = await fetchJson(url);
    const result = data.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const close = closes.find((x) => typeof x === "number");
    return typeof close === "number" ? close : 0;
  } catch {
    return 0;
  }
}

async function buildPortfolioData() {
  const holdings = (await readPortfolioConfig()).slice(0, PORTFOLIO_LIMIT);
  const symbols = holdings.map((h) => tickerToYahooSymbol(h.ticker));
  const currentPrices = await fetchCurrentPrices(symbols);
  const shouldResolveHistorical = holdings.length <= 100;

  const resolved = [];
  for (const item of holdings) {
    const symbol = tickerToYahooSymbol(item.ticker);
    let buyPrice = Number(item.buyPrice || 0);
    if (!buyPrice && item.snapshotDate && shouldResolveHistorical) {
      buyPrice = await fetchHistoricalClose(symbol, item.snapshotDate);
    }
    resolved.push({
      ticker: symbol,
      name: item.name,
      holdingQty: Number(item.holdingQty || 0),
      buyPrice: Math.round(buyPrice),
      snapshotDate: item.snapshotDate || "",
      keyword: item.keyword || item.name,
      currentPrice: Number(currentPrices[symbol] || 0),
    });
  }
  return resolved;
}

function buildFallbackPrices(holdings) {
  const out = {};
  for (const item of holdings) {
    const symbol = tickerToYahooSymbol(item.ticker);
    out[symbol] = Number(item.buyPrice || 0);
  }
  return out;
}

function buildFallbackNews(holdings) {
  const now = new Date().toISOString();
  return holdings.map((item, idx) => ({
    id: `fallback-${idx + 1}`,
    ticker: tickerToYahooSymbol(item.ticker),
    title: `${item.name} 관련 뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.`,
    source: "Local Fallback",
    publishedAt: now,
    url: "#",
  }));
}

function parseGoogleNewsRss(xml, ticker, limit) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const out = [];
  for (const item of items.slice(0, limit)) {
    const cdataTitle = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1];
    const plainTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const title = cdataTitle || plainTitle || "";
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "Google News";
    out.push({
      id: `${ticker}-${out.length + 1}`,
      ticker,
      title: stripHtml(safeHtmlDecode(title)),
      source: stripHtml(source),
      publishedAt: new Date(pubDate).toISOString(),
      url: link,
    });
  }
  return out;
}

async function fetchGoogleNewsByKeyword(keyword, ticker, limit = 4) {
  const q = encodeURIComponent(`${keyword} 주식`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  const xml = await fetchText(url);
  return parseGoogleNewsRss(xml, ticker, limit);
}

async function fetchNaverNewsByKeyword(keyword, ticker, limit = 5) {
  const params = new URLSearchParams({
    query: `${keyword} 주식`,
    display: String(limit),
    sort: "date",
  });
  const url = `https://openapi.naver.com/v1/search/news.json?${params.toString()}`;
  const data = await fetchJson(url, {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  return (data.items || []).map((item, idx) => ({
    id: `${ticker}-${idx + 1}`,
    ticker,
    title: stripHtml(safeHtmlDecode(item.title || "")),
    source: item.originallink ? "Naver News" : "Naver",
    publishedAt: new Date(item.pubDate).toISOString(),
    url: item.originallink || item.link || "#",
  }));
}

async function buildNewsData() {
  const holdings = (await readPortfolioConfig()).slice(0, PORTFOLIO_LIMIT);
  const newsTargets = holdings.slice(0, 30);
  const tasks = newsTargets.map(async (item) => {
    const symbol = tickerToYahooSymbol(item.ticker);
    const keyword = item.keyword || item.name;
    if (NAVER_CLIENT_ID && NAVER_CLIENT_SECRET) {
      markMetricAttempt("newsNaver");
      try {
        const items = await fetchNaverNewsByKeyword(keyword, symbol, 4);
        markMetricResult("newsNaver", true);
        return items;
      } catch {
        markMetricResult("newsNaver", false);
        return [];
      }
    }
    markMetricAttempt("newsGoogle");
    try {
      const items = await fetchGoogleNewsByKeyword(keyword, symbol, 4);
      markMetricResult("newsGoogle", true);
      return items;
    } catch {
      markMetricResult("newsGoogle", false);
      return [];
    }
  });

  const chunked = await Promise.all(tasks);
  return chunked.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/portfolio") {
    try {
      const items = await buildPortfolioData();
      const payload = items.map((item) => ({
        ticker: item.ticker,
        name: item.name,
        holdingQty: item.holdingQty,
        buyPrice: item.buyPrice,
        snapshotDate: item.snapshotDate,
      }));
      sendJson(res, 200, payload);
      return;
    } catch {
      const holdings = (await readPortfolioConfig()).slice(0, PORTFOLIO_LIMIT);
      const payload = holdings.map((item) => ({
        ticker: tickerToYahooSymbol(item.ticker),
        name: item.name,
        holdingQty: Number(item.holdingQty || 0),
        buyPrice: Number(item.buyPrice || 0),
        snapshotDate: item.snapshotDate || "",
      }));
      sendJson(res, 200, payload);
      return;
    }
  }

  if (pathname === "/api/prices") {
    try {
      const items = await getCachedResource("prices", PRICES_CACHE_TTL_MS, buildPortfolioData);
      const prices = {};
      for (const item of items) {
        prices[item.ticker] = item.currentPrice;
      }
      sendJson(res, 200, prices);
      logMetricsSummary("api-prices");
      return;
    } catch {
      const holdings = (await readPortfolioConfig()).slice(0, PORTFOLIO_LIMIT);
      sendJson(res, 200, buildFallbackPrices(holdings));
      logMetricsSummary("api-prices-fallback");
      return;
    }
  }

  if (pathname === "/api/news") {
    try {
      const news = await getCachedResource("news", NEWS_CACHE_TTL_MS, buildNewsData);
      sendJson(res, 200, news);
      logMetricsSummary("api-news");
      return;
    } catch {
      const holdings = (await readPortfolioConfig()).slice(0, PORTFOLIO_LIMIT);
      sendJson(res, 200, buildFallbackNews(holdings));
      logMetricsSummary("api-news-fallback");
      return;
    }
  }

  sendError(res, 404, "not_found", "Requested API endpoint was not found.");
}

async function handleStatic(req, res, pathname) {
  if (pathname === "/ads.txt") {
    const body = `google.com, ${ADSENSE_CLIENT.replace("ca-pub-", "pub-")}, DIRECT, f08c47fec0942fa0\n`;
    res.writeHead(
      200,
      buildDefaultHeaders({
        "Content-Type": MIME_TYPES[".txt"],
        "Cache-Control": "public, max-age=3600",
      }),
    );
    res.end(body);
    return;
  }

  const safePath = pathname === "/" ? "/index.html" : pathname;
  const abs = path.join(ROOT, safePath);
  if (!abs.startsWith(ROOT)) {
    sendError(res, 403, "forbidden", "Access to this resource is forbidden.");
    return;
  }

  try {
    const data = await fsp.readFile(abs);
    const ext = path.extname(abs);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const cacheControl =
      ext === ".html" ? "no-cache" : "public, max-age=300";
    res.writeHead(
      200,
      buildDefaultHeaders({
        "Content-Type": mime,
        "Cache-Control": cacheControl,
      }),
    );
    if (ext === ".html") {
      let text = data.toString("utf8");
      text = text.replaceAll("__ADSENSE_CLIENT__", ADSENSE_CLIENT);
      text = text.replaceAll("__ADSENSE_SLOT__", ADSENSE_SLOT);
      res.end(text);
      return;
    }
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(res, 404, "not_found", "Requested static resource was not found.");
      return;
    }
    sendError(res, 500, "server_error", "Unexpected server error.", error.message);
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "whereisinvest",
      time: new Date().toISOString(),
    });
    return;
  }

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }
  await handleStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`WhereIsInvest server running: http://localhost:${PORT}`);
});

setInterval(() => {
  logMetricsSummary("interval");
}, METRICS_LOG_INTERVAL_MS);
