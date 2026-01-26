// X Stock Ticker Tracker - Dashboard
// Displays and filters saved tweets

let allTweets = [];
let filteredTweets = [];

// DOM Elements
const searchInput = document.getElementById('searchInput');
const tickerFilter = document.getElementById('tickerFilter');
const authorFilter = document.getElementById('authorFilter');
const actionableFilter = document.getElementById('actionableFilter');
const exportBtn = document.getElementById('exportBtn');
const tweetList = document.getElementById('tweetList');
const totalCount = document.getElementById('totalCount');
const filteredCount = document.getElementById('filteredCount');

// Load tweets from storage
async function loadTweets() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_TWEETS' });
  allTweets = response.tweets || [];
  filteredTweets = [...allTweets];
  populateFilters();
  renderTweets();
  updateCounts();
}

// Populate filter dropdowns
function populateFilters() {
  const tickers = new Set();
  const authors = new Set();

  allTweets.forEach(tweet => {
    tweet.tickers.forEach(t => tickers.add(t));
    if (tweet.author) authors.add(tweet.author);
  });

  // Populate ticker filter
  tickerFilter.innerHTML = '<option value="">All Tickers</option>';
  [...tickers].sort().forEach(ticker => {
    const option = document.createElement('option');
    option.value = ticker;
    option.textContent = `$${ticker}`;
    tickerFilter.appendChild(option);
  });

  // Populate author filter
  authorFilter.innerHTML = '<option value="">All Authors</option>';
  [...authors].sort().forEach(author => {
    const option = document.createElement('option');
    option.value = author;
    option.textContent = `@${author}`;
    authorFilter.appendChild(option);
  });
}

// Apply filters
function applyFilters() {
  const searchTerm = searchInput.value.toLowerCase();
  const selectedTicker = tickerFilter.value;
  const selectedAuthor = authorFilter.value;
  const actionableOnly = actionableFilter.checked;

  filteredTweets = allTweets.filter(tweet => {
    // Search filter (also search in comments)
    if (searchTerm) {
      const textMatch = tweet.text.toLowerCase().includes(searchTerm);
      const commentMatch = tweet.comment && tweet.comment.toLowerCase().includes(searchTerm);
      if (!textMatch && !commentMatch) {
        return false;
      }
    }

    // Ticker filter
    if (selectedTicker && !tweet.tickers.includes(selectedTicker)) {
      return false;
    }

    // Author filter
    if (selectedAuthor && tweet.author !== selectedAuthor) {
      return false;
    }

    // Actionable filter
    if (actionableOnly && !tweet.actionable) {
      return false;
    }

    return true;
  });

  renderTweets();
  updateCounts();
}

// Update counts display
function updateCounts() {
  totalCount.textContent = `${allTweets.length} tweet${allTweets.length !== 1 ? 's' : ''} saved`;

  if (filteredTweets.length !== allTweets.length) {
    filteredCount.textContent = `(showing ${filteredTweets.length})`;
  } else {
    filteredCount.textContent = '';
  }
}

// Render tweets list
function renderTweets() {
  if (filteredTweets.length === 0) {
    if (allTweets.length === 0) {
      tweetList.innerHTML = `
        <div class="empty-state">
          <p>No saved tweets yet.</p>
          <p>Visit X.com and click the save button on tweets to get started!</p>
        </div>
      `;
    } else {
      tweetList.innerHTML = `
        <div class="empty-state">
          <p>No tweets match your filters.</p>
        </div>
      `;
    }
    return;
  }

  tweetList.innerHTML = filteredTweets.map(tweet => `
    <div class="tweet-card ${tweet.actionable ? 'actionable' : ''}" data-id="${tweet.id}">
      <div class="tweet-header">
        <div class="author-info">
          <span class="display-name">${escapeHtml(tweet.authorDisplayName || tweet.author)}</span>
          <span class="username">@${escapeHtml(tweet.author)}</span>
          ${tweet.actionable ? '<span class="actionable-badge">Actionable</span>' : ''}
        </div>
        <div class="tweet-actions">
          <a href="${tweet.url}" target="_blank" class="btn btn-small">View</a>
          <button class="btn btn-small btn-danger delete-btn" data-id="${tweet.id}">Delete</button>
        </div>
      </div>
      <div class="tweet-text">${escapeHtml(tweet.text)}</div>
      ${tweet.comment ? `<div class="tweet-comment"><strong>Note:</strong> ${escapeHtml(tweet.comment)}</div>` : ''}
      <div class="tweet-footer">
        <div class="tickers">
          ${tweet.tickers.length > 0
            ? tweet.tickers.map(t => `<span class="ticker-tag">$${t}</span>`).join('')
            : '<span class="no-tickers">No tickers detected</span>'
          }
        </div>
        <div class="tweet-dates">
          ${tweet.tweetedAt ? `<span class="tweeted-date">Tweeted ${formatDate(tweet.tweetedAt)}</span>` : ''}
          <span class="saved-date">Saved ${formatDate(tweet.savedAt)}</span>
        </div>
      </div>
    </div>
  `).join('');

  // Add delete handlers
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tweetId = e.target.dataset.id;
      if (confirm('Delete this saved tweet?')) {
        await deleteTweet(tweetId);
      }
    });
  });
}

// Delete a tweet
async function deleteTweet(tweetId) {
  await chrome.runtime.sendMessage({ type: 'DELETE_TWEET', tweetId });
  await loadTweets();
}

// Export to markdown
async function exportMarkdown() {
  const response = await chrome.runtime.sendMessage({ type: 'EXPORT_MARKDOWN' });
  const blob = new Blob([response.markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ticker-tracker-export-${new Date().toISOString().split('T')[0]}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Event listeners
searchInput.addEventListener('input', applyFilters);
tickerFilter.addEventListener('change', applyFilters);
authorFilter.addEventListener('change', applyFilters);
actionableFilter.addEventListener('change', applyFilters);
exportBtn.addEventListener('click', exportMarkdown);

// Initialize
loadTweets();
