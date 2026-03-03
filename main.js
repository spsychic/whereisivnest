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
};

const dom = {
  refreshButton: document.getElementById("refresh-button"),
  lastUpdated: document.getElementById("last-updated"),
  stockList: document.getElementById("stock-list"),
  newsList: document.getElementById("news-list"),
  stockTemplate: document.getElementById("stock-item-template"),
};

const apiConfig = {
  endpoints: {
    portfolio: "/api/portfolio",
    prices: "/api/prices",
    news: "/api/news",
  },
};

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

async function fetchPortfolio() {
  try {
    const res = await fetch(apiConfig.endpoints.portfolio);
    if (!res.ok) throw new Error("portfolio fetch failed");
    return res.json();
  } catch {
    return mockData.portfolio;
  }
}

async function fetchPrices() {
  try {
    const res = await fetch(apiConfig.endpoints.prices);
    if (!res.ok) throw new Error("prices fetch failed");
    return res.json();
  } catch {
    return mockData.prices;
  }
}

async function fetchNews() {
  try {
    const res = await fetch(apiConfig.endpoints.news);
    if (!res.ok) throw new Error("news fetch failed");
    return res.json();
  } catch {
    return mockData.news;
  }
}

function renderStocks() {
  dom.stockList.innerHTML = "";
  if (!appState.stocks.length) {
    dom.stockList.innerHTML = '<div class="empty-state">표시할 종목이 없습니다.</div>';
    return;
  }

  for (const stock of appState.stocks) {
    const fragment = dom.stockTemplate.content.cloneNode(true);
    const currentPrice = appState.prices[stock.ticker] || 0;
    const returnRate = calcReturnRate(currentPrice, stock.buyPrice);
    const isUp = returnRate >= 0;

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
    headerReturn.textContent = formatPercent(returnRate);
    headerReturn.className = `stock-return ${isUp ? "up" : "down"}`;
    qty.textContent = `${formatNumber(stock.holdingQty)}주`;
    buyPrice.textContent = `${formatNumber(stock.buyPrice)}원`;
    nowPrice.textContent = `${formatNumber(currentPrice)}원`;
    detailReturn.textContent = formatPercent(returnRate);
    detailReturn.className = `return-rate ${isUp ? "up" : "down"}`;
    snapshotDate.textContent = stock.snapshotDate;

    if (appState.selectedTicker === stock.ticker) {
      container.style.borderColor = "#8cb3e8";
    }

    head.addEventListener("click", () => {
      appState.selectedTicker = stock.ticker;
      renderStocks();
      renderNews();
    });

    dom.stockList.appendChild(fragment);
  }
}

function renderNews() {
  dom.newsList.innerHTML = "";
  let list = appState.news;

  if (appState.selectedTicker) {
    const selected = list.filter(
      (n) => !n.ticker || n.ticker === appState.selectedTicker,
    );
    if (selected.length) list = selected;
  }

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

async function refreshAll() {
  if (appState.isLoading) return;
  appState.isLoading = true;
  dom.refreshButton.disabled = true;
  dom.refreshButton.textContent = "갱신 중...";
  try {
    const [portfolio, prices, news] = await Promise.all([
      fetchPortfolio(),
      fetchPrices(),
      fetchNews(),
    ]);
    appState.stocks = portfolio;
    appState.prices = prices;
    appState.news = news;
    if (!appState.selectedTicker && appState.stocks.length) {
      appState.selectedTicker = appState.stocks[0].ticker;
    }
    renderStocks();
    renderNews();
    updateLastUpdated();
    safelyRenderAds();
  } catch (error) {
    console.error(error);
  } finally {
    appState.isLoading = false;
    dom.refreshButton.disabled = false;
    dom.refreshButton.textContent = "지금 새로고침";
  }
}

async function refreshPricesOnly() {
  try {
    appState.prices = await fetchPrices();
    renderStocks();
    updateLastUpdated();
  } catch (error) {
    console.error(error);
  }
}

async function refreshNewsOnly() {
  try {
    appState.news = await fetchNews();
    renderNews();
    updateLastUpdated();
  } catch (error) {
    console.error(error);
  }
}

function safelyRenderAds() {
  try {
    if (window.adsbygoogle) {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  } catch (error) {
    console.debug("AdSense rendering skipped:", error.message);
  }
}

function setupIntervals() {
  setInterval(refreshPricesOnly, REFRESH_PRICE_MS);
  setInterval(refreshNewsOnly, REFRESH_NEWS_MS);
  setInterval(refreshAll, REFRESH_FULL_MS);
}

function boot() {
  dom.refreshButton.addEventListener("click", refreshAll);
  refreshAll();
  setupIntervals();
}

boot();
