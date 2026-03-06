#!/usr/bin/env python3
import json
import random
import re
import urllib.request
from datetime import datetime
from pathlib import Path

OUT_DIR = Path('experiments/cnn_minute_samples/output')
OUT_DIR.mkdir(parents=True, exist_ok=True)

TOP_TICKERS = [
    ('005930', '삼성전자'),
    ('000660', 'SK하이닉스'),
    ('373220', 'LG에너지솔루션'),
    ('207940', '삼성바이오로직스'),
    ('005380', '현대차'),
    ('000270', '기아'),
    ('105560', 'KB금융'),
    ('068270', '셀트리온'),
    ('055550', '신한지주'),
    ('012330', '현대모비스'),
    ('035420', 'NAVER'),
    ('006400', '삼성SDI'),
    ('028260', '삼성물산'),
    ('012450', '한화에어로스페이스'),
    ('138040', '메리츠금융지주'),
    ('329180', 'HD현대중공업'),
    ('267260', 'HD현대일렉트릭'),
    ('034020', '두산에너빌리티'),
    ('066570', 'LG전자'),
    ('009540', 'HD한국조선해양'),
]

RANDOM_SEED = 20260304
SAMPLE_COUNT = 3
WINDOW_MINUTES = 20
CHART_COUNT = 2400
IMG_W = 64
IMG_H = 64
PRICE_TOP = 2
PRICE_BOTTOM = 50
VOL_TOP = 52
VOL_BOTTOM = 62


def fetch_minute_bars(ticker: str):
    url = (
        'https://fchart.stock.naver.com/sise.nhn?'
        f'symbol={ticker}&timeframe=minute&count={CHART_COUNT}&requestType=0'
    )
    with urllib.request.urlopen(url, timeout=20) as resp:
        xml = resp.read().decode('euc-kr', errors='ignore')

    rows = re.findall(r'<item\s+data="([^"]+)"\s*/>', xml)
    bars = []
    for row in rows:
        parts = row.split('|')
        if len(parts) < 6:
            continue
        ts, op, hi, lo, cl, vol = parts[:6]
        try:
            t = datetime.strptime(ts, '%Y%m%d%H%M')
            c = float(cl)
            v = float(vol)
        except ValueError:
            continue
        bars.append({'time': t, 'close': c, 'volume': v})
    return bars, url


def window_start_indices(bars, window):
    if len(bars) < window:
        return []
    return list(range(0, len(bars) - window + 1))


def draw_line(img, x, y1, y2, val):
    y_min, y_max = sorted((int(y1), int(y2)))
    for y in range(max(0, y_min), min(len(img), y_max + 1)):
        if 0 <= x < len(img[0]):
            img[y][x] = min(img[y][x], val)


def fill_rect(img, x1, y1, x2, y2, val):
    xa, xb = sorted((int(x1), int(x2)))
    ya, yb = sorted((int(y1), int(y2)))
    for y in range(max(0, ya), min(len(img), yb + 1)):
        row = img[y]
        for x in range(max(0, xa), min(len(row), xb + 1)):
            row[x] = min(row[x], val)


def to_price_y(price, p_min, p_max):
    if p_max <= p_min:
        return (PRICE_TOP + PRICE_BOTTOM) // 2
    ratio = (price - p_min) / (p_max - p_min)
    return int(PRICE_BOTTOM - ratio * (PRICE_BOTTOM - PRICE_TOP))


def draw_segment(img, x1, y1, x2, y2, val):
    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
    dx = abs(x2 - x1)
    dy = -abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    err = dx + dy
    x, y = x1, y1
    while True:
        if 0 <= y < len(img) and 0 <= x < len(img[0]):
            img[y][x] = min(img[y][x], val)
        if x == x2 and y == y2:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


def build_candlestick_pixels(window_bars):
    img = [[255 for _ in range(IMG_W)] for _ in range(IMG_H)]

    closes = [b['close'] for b in window_bars]
    vols = [b['volume'] for b in window_bars]
    p_min, p_max = min(closes), max(closes)
    v_max = max(vols) if vols else 1.0

    x_start, x_end = 4, IMG_W - 4
    step = (x_end - x_start) / max(1, len(window_bars) - 1)
    points = []

    for i, b in enumerate(window_bars):
        x = int(round(x_start + i * step))
        y_c = to_price_y(b['close'], p_min, p_max)
        points.append((x, y_c))
        fill_rect(img, x - 1, y_c - 1, x + 1, y_c + 1, 40)

        v_h = int((b['volume'] / v_max) * (VOL_BOTTOM - VOL_TOP)) if v_max > 0 else 0
        fill_rect(img, x - 1, VOL_BOTTOM - v_h, x + 1, VOL_BOTTOM, 160)

    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        draw_segment(img, x1, y1, x2, y2, 60)

    return img


def save_pgm(path: Path, pixels):
    h = len(pixels)
    w = len(pixels[0]) if h else 0
    with path.open('w', encoding='ascii') as f:
        f.write(f'P2\n{w} {h}\n255\n')
        for row in pixels:
            f.write(' '.join(str(int(v)) for v in row) + '\n')


def main():
    random.seed(RANDOM_SEED)

    candidates = TOP_TICKERS[:]
    random.shuffle(candidates)

    samples = []
    used = set()

    for ticker, name in candidates:
        if len(samples) >= SAMPLE_COUNT:
            break
        bars, url = fetch_minute_bars(ticker)
        starts = window_start_indices(bars, WINDOW_MINUTES)
        if not starts:
            continue

        start_idx = random.choice(starts)
        segment = bars[start_idx:start_idx + WINDOW_MINUTES]

        key = (ticker, segment[0]['time'])
        if key in used:
            continue
        used.add(key)

        pixels = build_candlestick_pixels(segment)

        stamp = segment[0]['time'].strftime('%Y%m%d_%H%M')
        base = f'sample_{len(samples)+1:02d}_{ticker}_{stamp}'

        pgm_path = OUT_DIR / f'{base}.pgm'
        json_path = OUT_DIR / f'{base}.json'

        save_pgm(pgm_path, pixels)
        json_payload = {
            'ticker': ticker,
            'name': name,
            'source': 'Naver fchart minute API',
            'source_url': url,
            'window_minutes': WINDOW_MINUTES,
            'start_time': segment[0]['time'].isoformat(),
            'end_time': segment[-1]['time'].isoformat(),
            'pixels_shape': [IMG_H, IMG_W],
            'pixels': pixels,
            'bars': [
                {
                    'time': b['time'].isoformat(),
                    'close': b['close'],
                    'volume': b['volume'],
                }
                for b in segment
            ],
        }
        json_path.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2), encoding='utf-8')

        samples.append({
            'id': len(samples) + 1,
            'ticker': ticker,
            'name': name,
            'start_time': segment[0]['time'].isoformat(),
            'end_time': segment[-1]['time'].isoformat(),
            'pgm_file': str(pgm_path),
            'json_file': str(json_path),
        })

    if len(samples) < SAMPLE_COUNT:
        raise RuntimeError(f'generated {len(samples)} samples, expected {SAMPLE_COUNT}')

    meta = {
        'created_at_utc': datetime.utcnow().isoformat() + 'Z',
        'random_seed': RANDOM_SEED,
        'sample_count': len(samples),
        'window_minutes': WINDOW_MINUTES,
        'image_shape': [IMG_H, IMG_W],
        'samples': samples,
    }
    (OUT_DIR / 'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
