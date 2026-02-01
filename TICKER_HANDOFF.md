# Stock Ticker Display Feature - Handoff Document

## Overview

This document contains all the code, context, and lessons learned for building a Chrome extension that displays stock information (price, market cap, performance) when hovering over $TICKER symbols on X/Twitter.

## The Problem

Yahoo Finance has become increasingly difficult to access programmatically:
1. **API Authentication**: Yahoo Finance's v10 API requires crumb/cookie authentication that's hard to obtain from a Chrome extension
2. **CORS Issues**: Direct API calls from Chrome extensions get blocked
3. **Market Cap**: The v8 chart API works for price/performance but does NOT return market cap
4. **Scraping**: Scraping finance.yahoo.com HTML works sometimes but is fragile

## Solutions Attempted

### What WORKS:
1. **Yahoo v8 Chart API** (for price + performance):
   ```
   https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d
   ```
   - Returns: currentPrice, previousClose, currency, shortName
   - Does NOT return: marketCap

2. **Local yfinance Python server** (for everything including market cap):
   - Most reliable solution
   - yfinance library handles Yahoo's authentication automatically
   - Returns full data including market cap
   - Requires user to run a local Python server

### What DOESN'T WORK reliably:
1. **Yahoo v10 quoteSummary API** - Requires crumb authentication
2. **Scraping finance.yahoo.com** - CORS blocked from extension, works from service worker but fragile
3. **Direct fetch from content script** - CORS blocked

## The Architecture That Works

```
Chrome Extension (JS) --> localhost:5050 --> yfinance (Python) --> Yahoo Finance
```

With fallback:
```
Chrome Extension (JS) --> Yahoo v8 API (no market cap)
```

---

## Code Files

### 1. Python Server (`stock_server.py`)

```python
"""
Local Stock Data Server using yfinance
Provides reliable market cap and stock data for the Chrome extension
"""

from flask import Flask, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime
import time

app = Flask(__name__)

# Configure CORS to allow Chrome extension requests
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "OPTIONS"],
        "allow_headers": ["Content-Type", "Accept"]
    }
})


@app.after_request
def add_cors_headers(response):
    """Add CORS headers to every response"""
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept'
    return response


# Simple in-memory cache with timestamps
cache = {}
CACHE_DURATION = 300  # 5 minutes in seconds


def get_cached(symbol):
    """Get cached data if still valid"""
    if symbol in cache:
        data, timestamp = cache[symbol]
        if time.time() - timestamp < CACHE_DURATION:
            return data
    return None


def set_cached(symbol, data):
    """Cache data with current timestamp"""
    cache[symbol] = (data, time.time())


def format_market_cap(value):
    """Format market cap to human readable string"""
    if value is None or value == 0:
        return "N/A"
    if value >= 1e12:
        return f"${value / 1e12:.2f}T"
    if value >= 1e9:
        return f"${value / 1e9:.2f}B"
    if value >= 1e6:
        return f"${value / 1e6:.2f}M"
    if value >= 1e3:
        return f"${value / 1e3:.2f}K"
    return f"${value:.2f}"


def calculate_performance(ticker, period, interval="1d"):
    """Calculate percentage performance for a given period"""
    try:
        hist = ticker.history(period=period, interval=interval)
        if hist.empty or len(hist) < 2:
            return None

        start_price = hist['Close'].iloc[0]
        end_price = hist['Close'].iloc[-1]

        if start_price == 0 or start_price is None:
            return None

        return ((end_price - start_price) / start_price) * 100
    except Exception:
        return None


@app.route('/quote/<symbol>')
def get_quote(symbol):
    """Get stock quote data including market cap"""
    symbol = symbol.upper().strip()

    # Check cache first
    cached = get_cached(symbol)
    if cached:
        return jsonify(cached)

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        # Get basic info
        current_price = info.get('currentPrice') or info.get('regularMarketPrice')
        previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose')
        market_cap = info.get('marketCap')
        name = info.get('shortName') or info.get('longName') or symbol
        currency = info.get('currency', 'USD')

        # Calculate 1D performance
        perf_1d = None
        if current_price and previous_close and previous_close != 0:
            perf_1d = ((current_price - previous_close) / previous_close) * 100

        # Calculate other performance periods
        perf_1m = calculate_performance(ticker, "1mo")
        perf_ytd = calculate_performance(ticker, "ytd")
        perf_1y = calculate_performance(ticker, "1y")
        perf_5y = calculate_performance(ticker, "5y", interval="1wk")

        result = {
            "symbol": symbol,
            "name": name,
            "price": current_price,
            "priceFormatted": f"{current_price:.2f}" if current_price else "N/A",
            "currency": currency,
            "marketCap": market_cap,
            "marketCapFormatted": format_market_cap(market_cap),
            "previousClose": previous_close,
            "performance": {
                "1D": round(perf_1d, 2) if perf_1d is not None else None,
                "1M": round(perf_1m, 2) if perf_1m is not None else None,
                "YTD": round(perf_ytd, 2) if perf_ytd is not None else None,
                "1Y": round(perf_1y, 2) if perf_1y is not None else None,
                "5Y": round(perf_5y, 2) if perf_5y is not None else None
            }
        }

        # Cache the result
        set_cached(symbol, result)

        return jsonify(result)

    except Exception as e:
        return jsonify({
            "symbol": symbol,
            "error": True,
            "message": str(e)
        }), 500


@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})


@app.route('/')
def index():
    """Root endpoint with API info"""
    return jsonify({
        "name": "Stock Ticker Display Server",
        "version": "1.0.0",
        "endpoints": {
            "/quote/<symbol>": "Get stock quote data",
            "/health": "Health check"
        }
    })


if __name__ == '__main__':
    print("Starting Stock Ticker Display Server...")
    print("Server running at http://localhost:5050")
    print("Test with: curl http://localhost:5050/quote/AAPL")
    print("Press Ctrl+C to stop")
    app.run(host='127.0.0.1', port=5050, debug=False)
```

### 2. Requirements (`requirements.txt`)

```
flask
yfinance
flask-cors
```

### 3. Startup Script (`start.sh`)

```bash
#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "Stock Ticker Display Server"
echo "=========================================="

if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required but not installed."
    exit 1
fi

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt

echo "Starting server at http://localhost:5050"
echo "Press Ctrl+C to stop"
python3 stock_server.py
```

---

### 4. Content Script - Ticker Detection & Tooltip (`content.js`)

```javascript
// Constants
const TICKER_REGEX = /\$([A-Z]{1,5})\b/g;
const TICKER_PROCESSED_ATTR = 'data-ticker-hover-processed';

// Tooltip state
let activeTooltip = null;
let tooltipTimeout = null;
let hideTimeout = null;

// Extract tickers from text
function extractTickers(text) {
  const matches = text.match(TICKER_REGEX);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

// Create ticker tooltip
function createTooltip() {
  const tooltip = document.createElement('div');
  tooltip.className = 'ticker-tracker-tooltip';
  tooltip.innerHTML = `
    <div class="ticker-tooltip-header">
      <span class="ticker-tooltip-symbol"></span>
      <span class="ticker-tooltip-name"></span>
    </div>
    <div class="ticker-tooltip-row">
      <span class="ticker-tooltip-label">Price:</span>
      <span class="ticker-tooltip-current"></span>
    </div>
    <div class="ticker-tooltip-row">
      <span class="ticker-tooltip-label">Market Cap:</span>
      <span class="ticker-tooltip-marketcap"></span>
    </div>
    <div class="ticker-tooltip-row ticker-tooltip-perf-row">
      <span class="perf-item">1D: <span class="perf-1d"></span></span>
      <span class="perf-item">1M: <span class="perf-1m"></span></span>
      <span class="perf-item">YTD: <span class="perf-ytd"></span></span>
      <span class="perf-item">1Y: <span class="perf-1y"></span></span>
      <span class="perf-item">5Y: <span class="perf-5y"></span></span>
    </div>
    <div class="ticker-tooltip-links">
      <a class="ticker-tooltip-link" target="_blank">View on Yahoo Finance</a>
    </div>
    <div class="ticker-tooltip-loading">Loading...</div>
  `;
  document.body.appendChild(tooltip);
  return tooltip;
}

// Get or create tooltip
function getTooltip() {
  let tooltip = document.querySelector('.ticker-tracker-tooltip');
  if (!tooltip) {
    tooltip = createTooltip();
  }
  return tooltip;
}

// Position tooltip near element
function positionTooltip(tooltip, element) {
  const rect = element.getBoundingClientRect();

  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 8;

  // Adjust if tooltip goes off right edge (320px width)
  if (left + 320 > window.innerWidth) {
    left = window.innerWidth - 330;
  }

  // Adjust if tooltip goes off bottom
  if (rect.bottom + 200 > window.innerHeight) {
    top = rect.top + window.scrollY - 208;
  }

  tooltip.style.left = `${Math.max(10, left)}px`;
  tooltip.style.top = `${top}px`;
}

// Format performance value with color class
function formatPerformance(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return { text: 'N/A', className: '' };
  }
  const isPositive = value >= 0;
  const text = `${isPositive ? '+' : ''}${value.toFixed(1)}%`;
  const className = isPositive ? 'positive' : 'negative';
  return { text, className };
}

// Show tooltip for a ticker
async function showTickerTooltip(element, symbol) {
  clearTimeout(hideTimeout);

  const tooltip = getTooltip();
  tooltip.classList.add('loading');
  tooltip.classList.add('visible');

  positionTooltip(tooltip, element);

  // Fetch stock info from background script
  let stockInfo;
  try {
    stockInfo = await chrome.runtime.sendMessage({
      type: 'GET_STOCK_INFO',
      symbol: symbol
    });
  } catch (error) {
    console.error('Error fetching stock info:', error);
    stockInfo = { error: true };
  }

  tooltip.classList.remove('loading');

  const perfRow = tooltip.querySelector('.ticker-tooltip-perf-row');
  const rows = tooltip.querySelectorAll('.ticker-tooltip-row');

  if (!stockInfo || stockInfo.error) {
    tooltip.querySelector('.ticker-tooltip-symbol').textContent = `$${symbol}`;
    tooltip.querySelector('.ticker-tooltip-name').textContent = '';
    rows.forEach(row => row.style.display = 'none');
    perfRow.style.display = 'none';
    tooltip.querySelector('.ticker-tooltip-link').href = `https://finance.yahoo.com/quote/${symbol}`;
    return;
  }

  // Populate tooltip
  tooltip.querySelector('.ticker-tooltip-symbol').textContent = `$${stockInfo.symbol}`;
  tooltip.querySelector('.ticker-tooltip-name').textContent = stockInfo.name;
  tooltip.querySelector('.ticker-tooltip-current').textContent = `$${stockInfo.priceFormatted}`;
  tooltip.querySelector('.ticker-tooltip-marketcap').textContent = stockInfo.marketCapFormatted || 'N/A';

  // Populate performance values
  const performance = stockInfo.performance || {};
  const perfPeriods = [
    { key: '1D', selector: '.perf-1d' },
    { key: '1M', selector: '.perf-1m' },
    { key: 'YTD', selector: '.perf-ytd' },
    { key: '1Y', selector: '.perf-1y' },
    { key: '5Y', selector: '.perf-5y' }
  ];

  perfPeriods.forEach(({ key, selector }) => {
    const el = tooltip.querySelector(selector);
    const { text, className } = formatPerformance(performance[key]);
    el.textContent = text;
    el.className = selector.slice(1) + (className ? ' ' + className : '');
  });

  rows.forEach(row => row.style.display = 'flex');
  perfRow.style.display = 'flex';
  tooltip.querySelector('.ticker-tooltip-link').href = `https://finance.yahoo.com/quote/${symbol}`;

  // Reposition after content loads
  setTimeout(() => positionTooltip(tooltip, element), 50);
}

// Hide tooltip
function hideTooltip() {
  hideTimeout = setTimeout(() => {
    const tooltip = document.querySelector('.ticker-tracker-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  }, 200);
}

// Wrap tickers in tweet text with hoverable spans
function wrapTickersInTweet(tweetElement) {
  const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetText || tweetText.hasAttribute(TICKER_PROCESSED_ATTR)) return;

  tweetText.setAttribute(TICKER_PROCESSED_ATTR, 'true');

  // Find text nodes and wrap tickers
  const walker = document.createTreeWalker(
    tweetText,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach(node => {
    const text = node.textContent;
    if (!TICKER_REGEX.test(text)) return;

    TICKER_REGEX.lastIndex = 0; // Reset regex state

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = TICKER_REGEX.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      // Create ticker span
      const span = document.createElement('span');
      span.className = 'ticker-tracker-ticker';
      span.textContent = match[0];
      span.dataset.symbol = match[1];

      // Add hover handlers
      span.addEventListener('mouseenter', (e) => {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => {
          showTickerTooltip(span, span.dataset.symbol);
        }, 300);
      });

      span.addEventListener('mouseleave', () => {
        clearTimeout(tooltipTimeout);
        hideTooltip();
      });

      fragment.appendChild(span);
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(fragment, node);
  });
}

// Set up tooltip hover handlers
function setupTooltipHover() {
  document.addEventListener('mouseover', (e) => {
    if (e.target.closest('.ticker-tracker-tooltip')) {
      clearTimeout(hideTimeout);
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.ticker-tracker-tooltip')) {
      hideTooltip();
    }
  });
}

// Process tweets
function processTweet(tweetElement) {
  wrapTickersInTweet(tweetElement);
}

function processAllTweets() {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  tweets.forEach(processTweet);
}

function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
    }
    if (shouldProcess) {
      clearTimeout(window.tickerTrackerTimeout);
      window.tickerTrackerTimeout = setTimeout(processAllTweets, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initialize
function init() {
  processAllTweets();
  setupObserver();
  setupTooltipHover();
  console.log('Stock Ticker Display initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

---

### 5. Background Script - Stock Data Fetching (`background.js`)

```javascript
const STOCK_CACHE_KEY = 'stockCache';
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
const LOCAL_SERVER_URL = 'http://localhost:5050';

// Fetch performance data for a specific time range (fallback)
async function fetchPerformanceForRange(symbol, range, interval) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const quotes = result.indicators?.quote?.[0];
    const closes = quotes?.close;
    if (!closes || closes.length === 0) return null;

    let startPrice = null;
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] !== null) {
        startPrice = closes[i];
        break;
      }
    }

    let endPrice = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] !== null) {
        endPrice = closes[i];
        break;
      }
    }

    if (startPrice === null || endPrice === null || startPrice === 0) return null;

    return ((endPrice - startPrice) / startPrice) * 100;
  } catch (error) {
    return null;
  }
}

// Try to fetch stock info from local yfinance server
async function fetchFromLocalServer(symbol) {
  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/quote/${symbol}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Local server returned ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.message || 'Server returned error');
    }

    return {
      symbol: data.symbol,
      name: data.name,
      currentPrice: data.price,
      priceFormatted: data.priceFormatted || (data.price?.toFixed(2) ?? 'N/A'),
      currency: data.currency || 'USD',
      marketCap: data.marketCap,
      marketCapFormatted: data.marketCapFormatted || formatMarketCap(data.marketCap),
      performance: data.performance || {},
      source: 'local-server'
    };
  } catch (error) {
    console.log('Local server unavailable:', error.message);
    return null;
  }
}

// Fallback: Fetch stock info directly from Yahoo Finance (NO MARKET CAP)
async function fetchFromYahooFinanceDirect(symbol) {
  const quoteUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const quoteResponse = await fetch(quoteUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  let stockInfo = {
    symbol: symbol,
    name: symbol,
    currentPrice: null,
    priceFormatted: 'N/A',
    currency: 'USD',
    marketCap: null,
    marketCapFormatted: 'N/A', // Cannot get from v8 API
    performance: {},
    source: 'yahoo-direct'
  };

  if (quoteResponse.ok) {
    const quoteData = await quoteResponse.json();
    const result = quoteData.chart?.result?.[0];
    const meta = result?.meta;

    if (meta) {
      stockInfo.name = meta.shortName || meta.longName || symbol;
      stockInfo.currentPrice = meta.regularMarketPrice;
      stockInfo.priceFormatted = meta.regularMarketPrice?.toFixed(2) || 'N/A';
      stockInfo.currency = meta.currency || 'USD';

      if (meta.regularMarketPrice && meta.previousClose && meta.previousClose !== 0) {
        stockInfo.performance['1D'] = ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100;
      }
    }
  }

  // Fetch multi-period performance
  const [perf1M, perfYTD, perf1Y, perf5Y] = await Promise.all([
    fetchPerformanceForRange(symbol, '1mo', '1d'),
    fetchPerformanceForRange(symbol, 'ytd', '1d'),
    fetchPerformanceForRange(symbol, '1y', '1d'),
    fetchPerformanceForRange(symbol, '5y', '1wk')
  ]);

  stockInfo.performance['1M'] = perf1M;
  stockInfo.performance['YTD'] = perfYTD;
  stockInfo.performance['1Y'] = perf1Y;
  stockInfo.performance['5Y'] = perf5Y;

  if (stockInfo.currentPrice !== null) {
    return stockInfo;
  }

  throw new Error('No data found for symbol');
}

function formatMarketCap(value) {
  if (!value || value === 0) return 'N/A';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

async function getStockCache() {
  const result = await chrome.storage.local.get(STOCK_CACHE_KEY);
  return result[STOCK_CACHE_KEY] || {};
}

async function saveStockCache(cache) {
  const entries = Object.entries(cache);
  if (entries.length > 50) {
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    cache = Object.fromEntries(entries.slice(0, 50));
  }
  await chrome.storage.local.set({ [STOCK_CACHE_KEY]: cache });
}

// Main fetch function - tries local server first, falls back to direct
async function fetchStockInfo(symbol) {
  const cache = await getStockCache();
  const cached = cache[symbol];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    // Try local yfinance server first (has market cap)
    let stockInfo = await fetchFromLocalServer(symbol);

    // Fall back to direct Yahoo Finance (no market cap)
    if (!stockInfo) {
      console.log(`Falling back to direct Yahoo Finance for ${symbol}`);
      stockInfo = await fetchFromYahooFinanceDirect(symbol);
    }

    cache[symbol] = { data: stockInfo, timestamp: Date.now() };
    await saveStockCache(cache);
    return stockInfo;

  } catch (error) {
    console.error('Error fetching stock info:', error);
    return { symbol, name: symbol, error: true };
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STOCK_INFO') {
    fetchStockInfo(message.symbol)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

console.log('Stock Ticker Display background initialized');
```

---

### 6. CSS Styles (`content.css`)

```css
/* Ticker hover styles */
.ticker-tracker-ticker {
  color: #1d9bf0;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 0.15s ease;
}

.ticker-tracker-ticker:hover {
  background-color: rgba(29, 155, 240, 0.15);
}

/* Tooltip styles - Windows 95 style */
.ticker-tracker-tooltip {
  position: absolute;
  z-index: 10001;
  min-width: 380px;
  background-color: #c0c0c0;
  border: 2px outset #dfdfdf;
  border-radius: 0;
  box-shadow: 2px 2px 0 #000;
  font-family: "MS Sans Serif", "Segoe UI", Tahoma, sans-serif;
  font-size: 14px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.1s ease, visibility 0.1s ease;
}

.ticker-tracker-tooltip.visible {
  opacity: 1;
  visibility: visible;
}

.ticker-tracker-tooltip.loading .ticker-tooltip-loading {
  display: block;
}

.ticker-tracker-tooltip.loading .ticker-tooltip-header,
.ticker-tracker-tooltip.loading .ticker-tooltip-row,
.ticker-tracker-tooltip.loading .ticker-tooltip-perf-row,
.ticker-tracker-tooltip.loading .ticker-tooltip-links {
  display: none !important;
}

.ticker-tooltip-loading {
  display: none;
  padding: 12px;
  text-align: center;
}

.ticker-tooltip-header {
  background-color: #000080;
  color: #fff;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
}

.ticker-tooltip-symbol {
  font-size: 15px;
  font-weight: bold;
}

.ticker-tooltip-name {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ticker-tooltip-row {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
}

.ticker-tooltip-label {
  font-size: 14px;
  color: #000;
}

.ticker-tooltip-current,
.ticker-tooltip-marketcap {
  font-size: 14px;
  font-weight: bold;
  color: #000;
}

.ticker-tooltip-perf-row {
  display: flex;
  gap: 12px;
  padding: 3px 8px;
  flex-wrap: nowrap;
}

.perf-item {
  font-size: 14px;
  color: #000;
  white-space: nowrap;
}

.perf-item .positive,
.ticker-tooltip-perf-row .positive {
  color: #008000;
  font-weight: bold;
}

.perf-item .negative,
.ticker-tooltip-perf-row .negative {
  color: #ff0000;
  font-weight: bold;
}

.ticker-tooltip-links {
  padding: 4px 8px 6px;
  border-top: 1px solid #808080;
  margin-top: 2px;
}

.ticker-tooltip-link {
  color: #0000ff;
  text-decoration: underline;
}

.ticker-tooltip-link:hover {
  color: #ff0000;
}
```

---

### 7. Manifest (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "X Stock Ticker Display",
  "version": "1.0.0",
  "description": "Display stock price and market cap when hovering over $TICKER symbols on X",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "*://x.com/*",
    "*://twitter.com/*",
    "*://query1.finance.yahoo.com/*",
    "*://localhost:5050/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://x.com/*", "*://twitter.com/*"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Known Issues & Gotchas

### 1. Port 5000 Conflict on macOS
macOS ControlCenter uses port 5000. Use port 5050 instead.

### 2. CORS for Chrome Extensions
Flask-CORS alone isn't enough. You need the `@app.after_request` decorator to add headers explicitly.

### 3. yfinance Caching
yfinance has its own internal caching. The server adds a 5-minute cache on top.

### 4. Market Cap Availability
Some stocks (especially small caps, international) may not have market cap data even from yfinance.

### 5. Rate Limiting
Yahoo Finance can rate limit. The caching helps, but heavy usage may still trigger limits.

---

## Future Improvements to Consider

1. **Browser storage for server URL** - Let users configure the server URL
2. **Alternative data sources** - Alpha Vantage, Finnhub as fallbacks
3. **Offline indicator** - Show when local server is down
4. **Error handling** - Better user feedback when data unavailable
5. **Options page** - Let users configure cache duration, enable/disable features

---

## Testing Commands

```bash
# Start the server
cd server && ./start.sh

# Test the server
curl http://localhost:5050/quote/AAPL
curl http://localhost:5050/quote/ASTS

# Check if server is running
lsof -i :5050
```

---

## Transcript Location

Full conversation history available at:
`/Users/parabhjeetsidhu/.claude/projects/-Users-parabhjeetsidhu/08afd250-5ce8-4b1b-8a85-d9ac7b24786e.jsonl`
