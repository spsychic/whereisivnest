const fs = require("fs/promises");
const path = require("path");

const inputPath = process.argv[2] || path.join(__dirname, "..", "data", "portfolio.csv");
const outputPath = process.argv[3] || path.join(__dirname, "..", "data", "portfolio.json");

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function toNumber(value, fieldName) {
  if (value === "") return 0;
  const numeric = Number(String(value).replaceAll(",", ""));
  if (Number.isNaN(numeric)) {
    throw new Error(`Invalid number for ${fieldName}: ${value}`);
  }
  return numeric;
}

function isValidDateYYYYMMDD(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const [y, m, d] = value.split("-").map(Number);
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
}

function normalizeTicker(raw) {
  const ticker = String(raw || "").trim();
  if (/^\d{6}$/.test(ticker)) return ticker;
  const match = ticker.match(/^(\d{6})\.(KS|KQ)$/i);
  if (match) return match[1];
  return "";
}

async function run() {
  const raw = await fs.readFile(inputPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("CSV has no data rows.");
  }

  const headers = parseCsvLine(lines[0]);
  const required = ["ticker", "name", "keyword", "holdingQty", "buyPrice", "snapshotDate"];
  for (const key of required) {
    if (!headers.includes(key)) {
      throw new Error(`Missing required header: ${key}`);
    }
  }

  const holdings = [];
  const errors = [];
  const warnings = [];
  const seenTickers = new Set();
  let zeroHoldingQtyCount = 0;
  let zeroBuyPriceCount = 0;

  const pushError = (lineNo, message) => {
    errors.push(`line ${lineNo}: ${message}`);
  };

  for (const [idx, line] of lines.slice(1).entries()) {
    const lineNo = idx + 2;
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = (cols[idx] || "").trim();
    });

    const normalizedTicker = normalizeTicker(row.ticker);
    if (!normalizedTicker) {
      pushError(lineNo, `invalid ticker format: "${row.ticker}"`);
      continue;
    }
    if (seenTickers.has(normalizedTicker)) {
      pushError(lineNo, `duplicate ticker: "${normalizedTicker}"`);
      continue;
    }
    seenTickers.add(normalizedTicker);

    if (!row.name) {
      pushError(lineNo, "name is empty");
      continue;
    }
    if (!row.snapshotDate || !isValidDateYYYYMMDD(row.snapshotDate)) {
      pushError(lineNo, `invalid snapshotDate: "${row.snapshotDate}"`);
      continue;
    }

    let holdingQty = 0;
    let buyPrice = 0;
    try {
      holdingQty = toNumber(row.holdingQty, "holdingQty");
      buyPrice = toNumber(row.buyPrice, "buyPrice");
    } catch (error) {
      pushError(lineNo, error.message);
      continue;
    }

    if (holdingQty === 0) zeroHoldingQtyCount += 1;
    if (buyPrice === 0) zeroBuyPriceCount += 1;

    holdings.push({
      ticker: normalizedTicker,
      name: row.name,
      keyword: row.keyword || row.name,
      holdingQty,
      buyPrice,
      snapshotDate: row.snapshotDate,
    });
  }

  if (errors.length) {
    const preview = errors.slice(0, 20).join("\n");
    const suffix = errors.length > 20 ? `\n...and ${errors.length - 20} more` : "";
    throw new Error(`Portfolio CSV validation failed (${errors.length} errors)\n${preview}${suffix}`);
  }

  if (zeroHoldingQtyCount > 0) {
    warnings.push(`holdingQty=0 rows: ${zeroHoldingQtyCount}`);
  }
  if (zeroBuyPriceCount > 0) {
    warnings.push(`buyPrice=0 rows: ${zeroBuyPriceCount}`);
  }

  const out = { holdings };
  await fs.writeFile(outputPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`Wrote ${holdings.length} holdings -> ${outputPath}`);
  if (warnings.length) {
    console.warn(`[WARN] ${warnings.join(" | ")}`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
