// X Stock Ticker Tracker - Background Service Worker
// Handles storage operations for saved tweets and stock data fetching

const STORAGE_KEY = 'savedTweets';
const STOCK_CACHE_KEY = 'stockCache';
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Fetch performance data for a specific time range
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

    // Get first valid close and last valid close
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
    console.log(`Could not fetch ${range} performance:`, error);
    return null;
  }
}

// Fetch stock info from Yahoo Finance with multi-period performance
async function fetchStockInfo(symbol) {
  // Check cache first
  const cache = await getStockCache();
  const cached = cache[symbol];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    // Fetch basic quote data
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
      performance: {
        '1D': null,
        '1M': null,
        'YTD': null,
        '1Y': null,
        '5Y': null
      }
    };

    if (quoteResponse.ok) {
      const quoteData = await quoteResponse.json();
      const meta = quoteData.chart?.result?.[0]?.meta;

      if (meta) {
        stockInfo.name = meta.shortName || meta.longName || symbol;
        stockInfo.currentPrice = meta.regularMarketPrice;
        stockInfo.priceFormatted = meta.regularMarketPrice?.toFixed(2) || 'N/A';
        stockInfo.currency = meta.currency || 'USD';

        // Calculate 1D performance from previous close
        if (meta.regularMarketPrice && meta.previousClose && meta.previousClose !== 0) {
          stockInfo.performance['1D'] = ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100;
        }
      }
    }

    // Fetch multi-period performance data in parallel
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

    // If we got at least a price, consider it a success
    if (stockInfo.currentPrice !== null) {
      // Cache the result
      cache[symbol] = { data: stockInfo, timestamp: Date.now() };
      await saveStockCache(cache);
      return stockInfo;
    }

    throw new Error('No data found for symbol');
  } catch (error) {
    console.error('Error fetching stock info:', error);
    return {
      symbol: symbol,
      name: symbol,
      error: true
    };
  }
}

// Stock cache helpers
async function getStockCache() {
  const result = await chrome.storage.local.get(STOCK_CACHE_KEY);
  return result[STOCK_CACHE_KEY] || {};
}

async function saveStockCache(cache) {
  // Limit cache size - keep only most recent 50 stocks
  const entries = Object.entries(cache);
  if (entries.length > 50) {
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    cache = Object.fromEntries(entries.slice(0, 50));
  }
  await chrome.storage.local.set({ [STOCK_CACHE_KEY]: cache });
}

// Get all saved tweets
async function getSavedTweets() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

// Save tweets to storage
async function saveTweets(tweets) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: tweets });
}

// Add a new tweet
async function addTweet(tweetData) {
  const tweets = await getSavedTweets();

  // Check for duplicate
  const exists = tweets.some(t => t.id === tweetData.id);
  if (exists) {
    return { success: false, duplicate: true };
  }

  tweets.unshift(tweetData); // Add to beginning

  // Check storage limits - sync storage has 100KB limit
  // If we're approaching the limit, remove oldest tweets
  const dataString = JSON.stringify(tweets);
  if (dataString.length > 90000) { // Leave some buffer
    tweets.pop(); // Remove oldest
  }

  await saveTweets(tweets);
  return { success: true };
}

// Delete a tweet by ID
async function deleteTweet(tweetId) {
  const tweets = await getSavedTweets();
  const filtered = tweets.filter(t => t.id !== tweetId);
  await saveTweets(filtered);
  return { success: true };
}

// Get stats for popup
async function getStats() {
  const tweets = await getSavedTweets();

  // Count tickers
  const tickerCounts = {};
  const authorCounts = {};

  tweets.forEach(tweet => {
    tweet.tickers.forEach(ticker => {
      tickerCounts[ticker] = (tickerCounts[ticker] || 0) + 1;
    });
    if (tweet.author) {
      authorCounts[tweet.author] = (authorCounts[tweet.author] || 0) + 1;
    }
  });

  // Sort and get top items
  const topTickers = Object.entries(tickerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    totalTweets: tweets.length,
    totalTickers: Object.keys(tickerCounts).length,
    topTickers,
    topAuthors,
    recentTweets: tweets.slice(0, 3)
  };
}

// Export tweets to markdown
function exportToMarkdown(tweets) {
  let markdown = '# Saved Stock Ticker Tweets\n\n';
  markdown += `Exported on ${new Date().toLocaleString()}\n\n`;
  markdown += `Total tweets: ${tweets.length}\n`;
  markdown += `Actionable trades: ${tweets.filter(t => t.actionable).length}\n\n---\n\n`;

  tweets.forEach(tweet => {
    markdown += `## @${tweet.author}`;
    if (tweet.actionable) {
      markdown += ` 🎯 ACTIONABLE`;
    }
    markdown += `\n\n`;
    markdown += `**Tickers:** ${tweet.tickers.length > 0 ? tweet.tickers.map(t => `$${t}`).join(', ') : 'None'}\n`;
    if (tweet.tweetedAt) {
      markdown += `**Tweeted:** ${new Date(tweet.tweetedAt).toLocaleString()}\n`;
    }
    markdown += `**Saved:** ${new Date(tweet.savedAt).toLocaleString()}\n\n`;
    markdown += `> ${tweet.text.split('\n').join('\n> ')}\n\n`;
    if (tweet.comment) {
      markdown += `**Notes:** ${tweet.comment}\n\n`;
    }
    markdown += `[View Tweet](${tweet.url})\n\n`;
    markdown += `---\n\n`;
  });

  return markdown;
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleMessage = async () => {
    switch (message.type) {
      case 'SAVE_TWEET':
        return await addTweet(message.data);

      case 'GET_TWEETS':
        return { tweets: await getSavedTweets() };

      case 'DELETE_TWEET':
        return await deleteTweet(message.tweetId);

      case 'GET_STATS':
        return await getStats();

      case 'EXPORT_MARKDOWN':
        const tweets = await getSavedTweets();
        return { markdown: exportToMarkdown(tweets) };

      case 'GET_STOCK_INFO':
        return await fetchStockInfo(message.symbol);

      case 'DOWNLOAD_MARKDOWN':
        try {
          const blob = new Blob([message.markdown], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          await chrome.downloads.download({
            url: url,
            filename: message.filename,
            saveAs: false
          });
          return { success: true };
        } catch (error) {
          console.error('Download error:', error);
          return { success: false, error: error.message };
        }

      default:
        return { error: 'Unknown message type' };
    }
  };

  handleMessage()
    .then(sendResponse)
    .catch(error => {
      console.error('Message handler error:', error);
      sendResponse({ error: error.message });
    });
  return true; // Keep message channel open for async response
});

console.log('X Stock Ticker Tracker background service worker initialized');
