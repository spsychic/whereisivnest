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
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = (cols[idx] || "").trim();
    });

    holdings.push({
      ticker: row.ticker,
      name: row.name,
      keyword: row.keyword || row.name,
      holdingQty: toNumber(row.holdingQty, "holdingQty"),
      buyPrice: toNumber(row.buyPrice, "buyPrice"),
      snapshotDate: row.snapshotDate,
    });
  }

  const out = { holdings };
  await fs.writeFile(outputPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`Wrote ${holdings.length} holdings -> ${outputPath}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
