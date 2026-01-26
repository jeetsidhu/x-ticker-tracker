// X Stock Ticker Tracker - Popup

// DOM Elements
const totalTweetsEl = document.getElementById('totalTweets');
const totalTickersEl = document.getElementById('totalTickers');
const topTickersEl = document.getElementById('topTickers');
const topTickersSection = document.getElementById('topTickersSection');
const recentTweetsEl = document.getElementById('recentTweets');
const recentSection = document.getElementById('recentSection');
const openDashboardBtn = document.getElementById('openDashboard');

// Load and display stats
async function loadStats() {
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

  totalTweetsEl.textContent = stats.totalTweets;
  totalTickersEl.textContent = stats.totalTickers;

  // Top tickers
  if (stats.topTickers.length > 0) {
    topTickersSection.style.display = 'block';
    topTickersEl.innerHTML = stats.topTickers
      .map(([ticker, count]) => `<span class="tag">$${ticker} <span class="count">${count}</span></span>`)
      .join('');
  } else {
    topTickersSection.style.display = 'none';
  }

  // Recent tweets
  if (stats.recentTweets.length > 0) {
    recentSection.style.display = 'block';
    recentTweetsEl.innerHTML = stats.recentTweets
      .map(tweet => `
        <div class="recent-tweet">
          <div class="tweet-author">@${escapeHtml(tweet.author)}</div>
          <div class="tweet-preview">${escapeHtml(truncate(tweet.text, 60))}</div>
        </div>
      `)
      .join('');
  } else {
    recentSection.style.display = 'none';
  }
}

// Open dashboard
openDashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Initialize
loadStats();
