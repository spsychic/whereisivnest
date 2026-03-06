const REFRESH_PRICE_MS = 60_000;
const REFRESH_NEWS_MS = 10 * 60_000;
const REFRESH_FULL_MS = 30 * 60_000;

const appState = {
  stocks: [],
  prices: {},
  news: [],
  selectedTicker: null,
  lastUpdated: null,
  isLoading: false,
  ui: {
    search: "",
    sort: "return_desc",
    returnFilter: "all",
  },
};

const runtimeConfig = window.WHEREISINVEST_CONFIG || {};

const dom = {
  refreshButton: document.getElementById("refresh-button"),
  lastUpdated: document.getElementById("last-updated"),
  systemStatus: document.getElementById("system-status"),
  stockSearch: document.getElementById("stock-search"),
  stockSort: document.getElementById("stock-sort"),
  returnFilter: document.getElementById("return-filter"),
  stockSummary: document.getElementById("stock-summary"),
  newsStatus: document.getElementById("news-status"),
  reliabilityNote: document.getElementById("reliability-note"),
  sourceList: document.getElementById("source-list"),
  stockList: document.getElementById("stock-list"),
  newsList: document.getElementById("news-list"),
  stockTemplate: document.getElementById("stock-item-template"),
  contactForm: document.getElementById("contact-form"),
  contactSubmit: document.getElementById("contact-submit"),
  contactStatus: document.getElementById("contact-status"),
};

const apiConfig = {
  endpoints: {
    portfolio: "/api/portfolio",
    portfolioStatic: "/data/portfolio.json",
    pricesStatic: "/data/prices.fallback.json",
    prices: "/api/prices",
    news: "/api/news",
  },
};

const DATA_SOURCES = [
  {
    label: "국민연금 기금운용본부 공시(국내주식 종목별 투자 현황)",
    url: "https://fund.nps.or.kr/impa/edwmpblnt/getOHEF0001M0.do",
    note: "보유 종목/평가액 기준",
  },
  {
    label: "네이버 증권 과거 시세 API",
    url: "https://fchart.stock.naver.com/",
    note: "기준일 종가(매입단가 대체값 산출)",
  },
  {
    label: "네이버 증권 실시간 시세 API",
    url: "https://polling.finance.naver.com/api/realtime",
    note: "현재가",
  },
  {
    label: "Google News RSS",
    url: "https://news.google.com/rss",
    note: "기본 뉴스 소스",
  },
];

const mockData = {
  portfolio: [
    {
      ticker: "005930.KS",
      name: "삼성전자",
      holdingQty: 1800000,
      buyPrice: 69000,
      snapshotDate: "2025-12-31",
    },
    {
      ticker: "000660.KS",
      name: "SK하이닉스",
      holdingQty: 420000,
      buyPrice: 145000,
      snapshotDate: "2025-12-31",
    },
    {
      ticker: "035420.KS",
      name: "NAVER",
      holdingQty: 170000,
      buyPrice: 198000,
      snapshotDate: "2025-12-31",
    },
  ],
  prices: {
    "005930.KS": 74800,
    "000660.KS": 164300,
    "035420.KS": 214500,
  },
  news: [
    {
      id: "n1",
      ticker: "005930.KS",
      title: "반도체 업황 회복 기대, 대형주 거래대금 증가",
      source: "경제뉴스",
      publishedAt: "2026-03-02T12:10:00+09:00",
      url: "#",
    },
    {
      id: "n2",
      ticker: "000660.KS",
      title: "AI 수요 확대로 메모리 가격 전망 상향",
      source: "마켓리포트",
      publishedAt: "2026-03-02T11:35:00+09:00",
      url: "#",
    },
    {
      id: "n3",
      ticker: "035420.KS",
      title: "플랫폼 광고 시장 회복세, 실적 추정치 조정",
      source: "증권브리핑",
      publishedAt: "2026-03-02T10:55:00+09:00",
      url: "#",
    },
    {
      id: "n4",
      ticker: "",
      title: "국내 증시 변동성 확대, 기관 수급 주목",
      source: "시장속보",
      publishedAt: "2026-03-02T09:30:00+09:00",
      url: "#",
    },
  ],
};

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMaybeMoney(value, unit) {
  const numeric = Number(value || 0);
  if (!numeric) return "미입력";
  return `${formatNumber(numeric)}${unit}`;
}

function formatMaybeQty(value) {
  const numeric = Number(value || 0);
  if (!numeric) return "미입력";
  return `${formatNumber(numeric)}주`;
}

function formatDateTime(dateObj) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(dateObj);
}

function calcReturnRate(currentPrice, buyPrice) {
  if (!currentPrice || !buyPrice) return 0;
  return ((currentPrice - buyPrice) / buyPrice) * 100;
}

function tickerToYahooSymbol(ticker) {
  if (typeof ticker !== "string") return "";
  if (ticker.endsWith(".KS") || ticker.endsWith(".KQ")) return ticker;
  if (/^\d{6}$/.test(ticker)) return `${ticker}.KS`;
  return ticker;
}

function shouldUseMockFallback() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function fetchStrict(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} fetch failed (${response.status})`);
  }
  return response.json();
}

async function fetchPortfolioFromStaticFile() {
  const data = await fetchStrict(apiConfig.endpoints.portfolioStatic, "portfolio-static");
  const holdings = Array.isArray(data?.holdings) ? data.holdings : [];
  return holdings.map((item) => ({
    ticker: tickerToYahooSymbol(item.ticker || ""),
    name: item.name || "",
    holdingQty: Number(item.holdingQty || 0),
    buyPrice: Number(item.buyPrice || 0),
    snapshotDate: item.snapshotDate || "",
  }));
}

async function fetchPricesFromStaticFile() {
  const data = await fetchStrict(apiConfig.endpoints.pricesStatic, "prices-static");
  if (!data || typeof data !== "object") return {};
  return data;
}

function setSystemStatus(type, message) {
  dom.systemStatus.className = `system-status ${type}`;
  dom.systemStatus.textContent = message;
}

function setLoading(loading) {
  appState.isLoading = loading;
  dom.refreshButton.disabled = loading;
  dom.stockSearch.disabled = loading;
  dom.stockSort.disabled = loading;
  dom.returnFilter.disabled = loading;
  dom.refreshButton.textContent = loading ? "갱신 중..." : "지금 새로고침";
}

function isValidFormspreeEndpoint(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "#" || trimmed.includes("__FORMSPREE_ENDPOINT__")) return false;
  return /^https:\/\/formspree\.io\/f\/[A-Za-z0-9]+$/.test(trimmed);
}

function isValidAdsenseClient(value) {
  if (typeof value !== "string") return false;
  return /^ca-pub-\d{10,}$/.test(value.trim());
}

function isValidAdsenseSlot(value) {
  if (typeof value !== "string") return false;
  return /^\d{6,}$/.test(value.trim());
}

function loadAdsenseScript(client) {
  const src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = src;
  document.head.appendChild(script);
}

function getEnrichedStocks() {
  return appState.stocks.map((stock) => {
    const currentPrice = Number(appState.prices[stock.ticker] || 0);
    const buyPrice = Number(stock.buyPrice || 0);
    const returnRate = calcReturnRate(currentPrice, buyPrice);
    const marketValue = currentPrice * Number(stock.holdingQty || 0);
    return {
      ...stock,
      currentPrice,
      buyPrice,
      returnRate,
      marketValue,
    };
  });
}

function getVisibleStocks() {
  const keyword = appState.ui.search.trim().toLowerCase();
  let list = getEnrichedStocks();

  if (keyword) {
    list = list.filter((item) => {
      const target = `${item.name} ${item.ticker}`.toLowerCase();
      return target.includes(keyword);
    });
  }

  if (appState.ui.returnFilter === "gain") {
    list = list.filter((item) => item.returnRate > 0);
  } else if (appState.ui.returnFilter === "loss") {
    list = list.filter((item) => item.returnRate < 0);
  } else if (appState.ui.returnFilter === "flat") {
    list = list.filter((item) => item.returnRate === 0);
  }

  const sorted = [...list];
  if (appState.ui.sort === "return_desc") {
    sorted.sort((a, b) => b.returnRate - a.returnRate);
  } else if (appState.ui.sort === "return_asc") {
    sorted.sort((a, b) => a.returnRate - b.returnRate);
  } else if (appState.ui.sort === "value_desc") {
    sorted.sort((a, b) => b.marketValue - a.marketValue);
  } else if (appState.ui.sort === "name_asc") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  }

  return sorted;
}

function loadCachedPrices() {
  try {
    const raw = window.localStorage.getItem("whereisinvest:lastPrices");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCachedPrices(prices) {
  try {
    window.localStorage.setItem("whereisinvest:lastPrices", JSON.stringify(prices || {}));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function renderStocks() {
  dom.stockList.innerHTML = "";
  const visibleStocks = getVisibleStocks();
  const missingQtyCount = appState.stocks.filter((item) => !Number(item.holdingQty || 0)).length;
  const missingBuyPriceCount = appState.stocks.filter((item) => !Number(item.buyPrice || 0)).length;

  dom.stockSummary.textContent =
    `표시 ${visibleStocks.length} / 전체 ${appState.stocks.length} · ` +
    `수량 미입력 ${missingQtyCount} · 매입단가 미입력 ${missingBuyPriceCount}`;

  if (!visibleStocks.length) {
    dom.stockList.innerHTML = '<div class="empty-state">조건에 맞는 종목이 없습니다.</div>';
    return;
  }

  for (const stock of visibleStocks) {
    const fragment = dom.stockTemplate.content.cloneNode(true);
    const isUp = stock.returnRate >= 0;

    const container = fragment.querySelector(".stock-item");
    const head = fragment.querySelector(".stock-head");
    const nameEl = fragment.querySelector(".stock-name");
    const headerReturn = fragment.querySelector(".stock-return");
    const qty = fragment.querySelector(".holding-qty");
    const buyPrice = fragment.querySelector(".buy-price");
    const nowPrice = fragment.querySelector(".current-price");
    const detailReturn = fragment.querySelector(".return-rate");
    const snapshotDate = fragment.querySelector(".snapshot-date");

    nameEl.textContent = `${stock.name} (${stock.ticker})`;
    headerReturn.textContent = formatPercent(stock.returnRate);
    headerReturn.className = `stock-return ${isUp ? "up" : "down"}`;
    qty.textContent = formatMaybeQty(stock.holdingQty);
    buyPrice.textContent = formatMaybeMoney(stock.buyPrice, "원");
    nowPrice.textContent = formatMaybeMoney(stock.currentPrice, "원");
    detailReturn.textContent = formatPercent(stock.returnRate);
    detailReturn.className = `return-rate ${isUp ? "up" : "down"}`;
    if (!stock.buyPrice || !stock.currentPrice) {
      detailReturn.textContent = "미입력";
      detailReturn.className = "return-rate neutral";
    }
    snapshotDate.textContent = stock.snapshotDate;

    if (appState.selectedTicker === stock.ticker) {
      container.classList.add("is-selected");
    }

    head.addEventListener("click", () => {
      appState.selectedTicker = stock.ticker;
      renderStocks();
      renderNews();
    });

    dom.stockList.appendChild(fragment);
  }
}

function renderSourceSection() {
  if (!dom.sourceList || !dom.reliabilityNote) return;

  dom.sourceList.innerHTML = "";
  for (const source of DATA_SOURCES) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = source.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = source.label;
    const note = document.createElement("span");
    note.textContent = source.note;
    li.appendChild(a);
    li.appendChild(note);
    dom.sourceList.appendChild(li);
  }

  const total = appState.stocks.length || 0;
  const reliableQty = appState.stocks.filter((x) => Number(x.holdingQty || 0) > 0).length;
  const reliableBuy = appState.stocks.filter((x) => Number(x.buyPrice || 0) > 0).length;
  const qtyRate = total ? ((reliableQty / total) * 100).toFixed(1) : "0.0";
  const buyRate = total ? ((reliableBuy / total) * 100).toFixed(1) : "0.0";
  const latestSnapshotYear = appState.stocks.reduce((acc, item) => {
    const year = Number(String(item.snapshotDate || "").slice(0, 4));
    if (Number.isFinite(year) && year > acc) return year;
    return acc;
  }, 0);

  dom.reliabilityNote.textContent =
    `현재 화면 기준 데이터 커버리지: 보유수량 ${reliableQty}/${total} (${qtyRate}%), ` +
    `매입단가 ${reliableBuy}/${total} (${buyRate}%). ` +
    `데이터 기준 국민연금 투자종목 최신 공개 연도는 ${latestSnapshotYear || "-"}입니다 ` +
    `(연도 말 세부 내역은 다음 해 3분기 공시 규정).`;
}

function renderNews() {
  dom.newsList.innerHTML = "";
  let list = appState.news;

  if (appState.selectedTicker) {
    const selected = list.filter((n) => !n.ticker || n.ticker === appState.selectedTicker);
    if (selected.length) list = selected;
  }

  dom.newsStatus.textContent = appState.selectedTicker
    ? `선택 종목 기준 뉴스 ${list.length}건`
    : `전체 뉴스 ${list.length}건`;

  if (!list.length) {
    dom.newsList.innerHTML = '<div class="empty-state">표시할 뉴스가 없습니다.</div>';
    return;
  }

  for (const item of list) {
    const el = document.createElement("a");
    el.className = "news-item";
    el.href = item.url || "#";
    el.target = "_blank";
    el.rel = "noopener noreferrer";

    const published = new Date(item.publishedAt);
    const title = document.createElement("strong");
    title.textContent = item.title;

    const meta = document.createElement("p");
    meta.className = "news-meta";
    meta.textContent = `${item.source} · ${formatDateTime(published)}`;

    el.appendChild(title);
    el.appendChild(meta);
    dom.newsList.appendChild(el);
  }
}

function updateLastUpdated() {
  appState.lastUpdated = new Date();
  dom.lastUpdated.textContent = `마지막 갱신: ${formatDateTime(appState.lastUpdated)} KST`;
}

function ensureSelectedTicker() {
  if (!appState.stocks.length) {
    appState.selectedTicker = null;
    return;
  }
  const hasCurrent = appState.stocks.some((item) => item.ticker === appState.selectedTicker);
  if (!hasCurrent) {
    appState.selectedTicker = appState.stocks[0].ticker;
  }
}

function renderAll() {
  ensureSelectedTicker();
  renderStocks();
  renderNews();
  renderSourceSection();
}

async function refreshAll() {
  if (appState.isLoading) return;

  setLoading(true);
  setSystemStatus("loading", "전체 데이터를 갱신하는 중입니다...");

  const results = await Promise.allSettled([
    fetchStrict(apiConfig.endpoints.portfolio, "portfolio"),
    fetchStrict(apiConfig.endpoints.prices, "prices"),
    fetchStrict(apiConfig.endpoints.news, "news"),
  ]);

  const degraded = [];
  const allowMock = shouldUseMockFallback();

  if (results[0].status === "fulfilled") {
    appState.stocks = results[0].value;
  } else {
    try {
      appState.stocks = await fetchPortfolioFromStaticFile();
      degraded.push("보유종목(정적파일)");
    } catch {
      if (allowMock) {
        appState.stocks = mockData.portfolio;
        degraded.push("보유종목");
      } else {
        appState.stocks = [];
        degraded.push("보유종목(연결실패)");
      }
    }
  }

  if (results[1].status === "fulfilled") {
    appState.prices = results[1].value;
    saveCachedPrices(appState.prices);
  } else if (allowMock) {
    appState.prices = mockData.prices;
    degraded.push("가격");
  } else {
    const cached = loadCachedPrices();
    if (Object.keys(cached).length) {
      appState.prices = cached;
      degraded.push("가격(캐시)");
    } else {
      try {
        appState.prices = await fetchPricesFromStaticFile();
        degraded.push("가격(정적스냅샷)");
      } catch {
        appState.prices = {};
        degraded.push("가격(연결실패)");
      }
    }
  }

  if (results[2].status === "fulfilled") {
    appState.news = results[2].value;
  } else if (allowMock) {
    appState.news = mockData.news;
    degraded.push("뉴스");
  } else {
    appState.news = [];
    degraded.push("뉴스(연결실패)");
  }

  renderAll();
  updateLastUpdated();
  safelyRenderAds();

  if (degraded.length) {
    setSystemStatus("warn", `일부 데이터(${degraded.join(", ")})는 임시 데이터로 표시 중입니다.`);
  } else {
    setSystemStatus("ok", "모든 데이터가 정상 갱신되었습니다.");
  }

  setLoading(false);
}

async function refreshPricesOnly() {
  try {
    appState.prices = await fetchStrict(apiConfig.endpoints.prices, "prices");
    renderStocks();
    updateLastUpdated();
    setSystemStatus("ok", "가격 데이터가 갱신되었습니다.");
  } catch (error) {
    console.error(error);
    setSystemStatus("warn", "가격 데이터 갱신에 실패했습니다. 이전 값을 유지합니다.");
  }
}

async function refreshNewsOnly() {
  try {
    appState.news = await fetchStrict(apiConfig.endpoints.news, "news");
    renderNews();
    updateLastUpdated();
    setSystemStatus("ok", "뉴스 데이터가 갱신되었습니다.");
  } catch (error) {
    console.error(error);
    setSystemStatus("warn", "뉴스 데이터 갱신에 실패했습니다. 이전 값을 유지합니다.");
  }
}

function safelyRenderAds() {
  try {
    const adSlot = document.querySelector(".ad-slot");
    const client = String(runtimeConfig.adsenseClient || "").trim();
    const slot = String(runtimeConfig.adsenseSlot || "").trim();
    if (!isValidAdsenseClient(client)) return;

    loadAdsenseScript(client);
    if (!adSlot || !isValidAdsenseSlot(slot)) return;

    adSlot.setAttribute("data-ad-client", client);
    adSlot.setAttribute("data-ad-slot", slot);
    if (window.adsbygoogle) (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (error) {
    console.debug("AdSense rendering skipped:", error.message);
  }
}

function setupIntervals() {
  setInterval(refreshPricesOnly, REFRESH_PRICE_MS);
  setInterval(refreshNewsOnly, REFRESH_NEWS_MS);
  setInterval(refreshAll, REFRESH_FULL_MS);
}

function setupControls() {
  dom.stockSearch.addEventListener("input", (event) => {
    appState.ui.search = event.target.value;
    renderStocks();
  });

  dom.stockSort.addEventListener("change", (event) => {
    appState.ui.sort = event.target.value;
    renderStocks();
  });

  dom.returnFilter.addEventListener("change", (event) => {
    appState.ui.returnFilter = event.target.value;
    renderStocks();
  });
}

function setContactStatus(type, message) {
  if (!dom.contactStatus) return;
  dom.contactStatus.className = `contact-status ${type}`;
  dom.contactStatus.textContent = message;
}

function setupContactForm() {
  if (!dom.contactForm || !dom.contactSubmit) return;

  const endpointFromConfig = String(runtimeConfig.formspreeEndpoint || "").trim();
  const actionFromDom = String(dom.contactForm.getAttribute("action") || "").trim();
  const action = isValidFormspreeEndpoint(endpointFromConfig)
    ? endpointFromConfig
    : actionFromDom;
  const enabled = isValidFormspreeEndpoint(action);

  if (!enabled) {
    const fields = dom.contactForm.querySelectorAll("input, textarea, button");
    for (const field of fields) field.disabled = true;
    setContactStatus("warn", "문의 폼이 아직 활성화되지 않았습니다. 관리자 설정 후 이용 가능합니다.");
    return;
  }

  dom.contactForm.setAttribute("action", action);

  dom.contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (dom.contactSubmit.disabled) return;

    dom.contactSubmit.disabled = true;
    dom.contactSubmit.textContent = "전송 중...";
    setContactStatus("loading", "문의 내용을 전송하고 있습니다.");

    try {
      const response = await fetch(action, {
        method: "POST",
        body: new FormData(dom.contactForm),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`form submit failed (${response.status})`);
      }

      dom.contactForm.reset();
      setContactStatus("ok", "문의가 접수되었습니다. 확인 후 답변드리겠습니다.");
    } catch (error) {
      console.error(error);
      setContactStatus("warn", "문의 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      dom.contactSubmit.disabled = false;
      dom.contactSubmit.textContent = "문의 보내기";
    }
  });
}

function boot() {
  dom.refreshButton.addEventListener("click", refreshAll);
  setupControls();
  setupContactForm();
  refreshAll();
  setupIntervals();
}

boot();
