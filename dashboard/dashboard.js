// X Stock Ticker Tracker - Dashboard
// Displays and filters saved tweets

let allTweets = [];
let filteredTweets = [];
let allAuthors = {};
let filteredAuthors = [];
let currentEditAuthor = null;

// DOM Elements - Tweets Tab
const searchInput = document.getElementById('searchInput');
const tickerFilter = document.getElementById('tickerFilter');
const authorFilter = document.getElementById('authorFilter');
const actionableFilter = document.getElementById('actionableFilter');
const exportBtn = document.getElementById('exportBtn');
const tweetList = document.getElementById('tweetList');
const totalCount = document.getElementById('totalCount');
const filteredCount = document.getElementById('filteredCount');

// DOM Elements - Authors Tab
const authorSearchInput = document.getElementById('authorSearchInput');
const exportAuthorsBtn = document.getElementById('exportAuthorsBtn');
const importAuthorsFile = document.getElementById('importAuthorsFile');
const authorList = document.getElementById('authorList');
const authorTotalCount = document.getElementById('authorTotalCount');
const authorFilteredCount = document.getElementById('authorFilteredCount');

// DOM Elements - Edit Author Modal
const editAuthorModal = document.getElementById('editAuthorModal');
const editAuthorHandle = document.getElementById('editAuthorHandle');
const editAuthorTweetCount = document.getElementById('editAuthorTweetCount');
const editAuthorTags = document.getElementById('editAuthorTags');
const editAuthorNotes = document.getElementById('editAuthorNotes');

// Tab Elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

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

// Tab switching
function switchTab(tabId) {
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `${tabId}-tab`);
  });

  if (tabId === 'authors') {
    loadAuthors();
  }
}

// Load authors from storage
async function loadAuthors() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_AUTHOR_TAGS' });
  allAuthors = response.authorTags || {};
  filteredAuthors = Object.values(allAuthors);
  renderAuthors();
  updateAuthorCounts();
}

// Apply author filters
function applyAuthorFilters() {
  const searchTerm = authorSearchInput.value.toLowerCase();

  filteredAuthors = Object.values(allAuthors).filter(author => {
    if (searchTerm) {
      const handleMatch = author.handle.toLowerCase().includes(searchTerm);
      const displayMatch = author.displayName?.toLowerCase().includes(searchTerm);
      const tagsMatch = author.tags?.some(t => t.toLowerCase().includes(searchTerm));
      const notesMatch = author.notes?.toLowerCase().includes(searchTerm);
      if (!handleMatch && !displayMatch && !tagsMatch && !notesMatch) {
        return false;
      }
    }
    return true;
  });

  // Sort by tweet count descending
  filteredAuthors.sort((a, b) => (b.tweetCount || 0) - (a.tweetCount || 0));

  renderAuthors();
  updateAuthorCounts();
}

// Update author counts display
function updateAuthorCounts() {
  const totalAuthors = Object.keys(allAuthors).length;
  authorTotalCount.textContent = `${totalAuthors} author${totalAuthors !== 1 ? 's' : ''}`;

  if (filteredAuthors.length !== totalAuthors) {
    authorFilteredCount.textContent = `(showing ${filteredAuthors.length})`;
  } else {
    authorFilteredCount.textContent = '';
  }
}

// Render authors list
function renderAuthors() {
  if (filteredAuthors.length === 0) {
    if (Object.keys(allAuthors).length === 0) {
      authorList.innerHTML = `
        <div class="empty-state">
          <p>No author tags yet.</p>
          <p>Save tweets to automatically track authors, or add tags in the save modal.</p>
        </div>
      `;
    } else {
      authorList.innerHTML = `
        <div class="empty-state">
          <p>No authors match your search.</p>
        </div>
      `;
    }
    return;
  }

  authorList.innerHTML = filteredAuthors.map(author => `
    <div class="author-card" data-handle="${escapeHtml(author.handle)}">
      <div class="author-card-header">
        <div class="author-card-info">
          <span class="author-card-name">${escapeHtml(author.displayName || author.handle)}</span>
          <span class="author-card-handle">@${escapeHtml(author.handle)}</span>
        </div>
        <div class="author-card-stats">
          <span class="author-tweet-badge">${author.tweetCount || 0} tweets</span>
          <button class="btn btn-small edit-author-btn" data-handle="${escapeHtml(author.handle)}">Edit</button>
        </div>
      </div>
      ${author.tags && author.tags.length > 0 ? `
        <div class="author-card-tags">
          ${author.tags.map(t => `<span class="author-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      ` : ''}
      ${author.notes ? `
        <div class="author-card-notes">${escapeHtml(author.notes)}</div>
      ` : ''}
      <div class="author-card-footer">
        <span class="author-card-date">Added ${formatDate(author.createdAt)}</span>
      </div>
    </div>
  `).join('');

  // Add edit handlers
  document.querySelectorAll('.edit-author-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditAuthorModal(e.target.dataset.handle);
    });
  });
}

// Show edit author modal
function showEditAuthorModal(handle) {
  const author = allAuthors[handle];
  if (!author) return;

  currentEditAuthor = handle;
  editAuthorHandle.textContent = `@${author.handle}`;
  editAuthorTweetCount.textContent = `${author.tweetCount || 0} tweets saved`;
  editAuthorTags.value = author.tags?.join(', ') || '';
  editAuthorNotes.value = author.notes || '';

  editAuthorModal.classList.add('visible');
}

// Close edit author modal
function closeEditAuthorModal() {
  editAuthorModal.classList.remove('visible');
  currentEditAuthor = null;
}

// Save author from modal
async function saveAuthorFromModal() {
  if (!currentEditAuthor) return;

  const tagsInput = editAuthorTags.value.trim();
  const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
  const notes = editAuthorNotes.value.trim();

  await chrome.runtime.sendMessage({
    type: 'SAVE_AUTHOR_TAG',
    data: {
      handle: currentEditAuthor,
      tags,
      notes
    }
  });

  closeEditAuthorModal();
  await loadAuthors();
}

// Delete author
async function deleteAuthor() {
  if (!currentEditAuthor) return;

  if (confirm(`Delete author @${currentEditAuthor}? This will only remove the tags, not saved tweets.`)) {
    await chrome.runtime.sendMessage({
      type: 'DELETE_AUTHOR_TAG',
      handle: currentEditAuthor
    });

    closeEditAuthorModal();
    await loadAuthors();
  }
}

// Export authors to JSON
async function exportAuthors() {
  const response = await chrome.runtime.sendMessage({ type: 'EXPORT_AUTHOR_TAGS' });
  const filename = `ticker-tracker-authors-${new Date().toISOString().split('T')[0]}.json`;

  await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_AUTHOR_TAGS',
    json: response.json,
    filename: filename
  });
}

// Handle author import
async function handleAuthorImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const result = await chrome.runtime.sendMessage({
      type: 'IMPORT_AUTHOR_TAGS',
      json: e.target.result,
      merge: true
    });

    if (result.success) {
      alert(`Successfully imported ${result.count} author(s).`);
      await loadAuthors();
    } else {
      alert(`Import failed: ${result.error}`);
    }

    // Reset file input
    event.target.value = '';
  };
  reader.readAsText(file);
}

// Event listeners - Tweets Tab
searchInput.addEventListener('input', applyFilters);
tickerFilter.addEventListener('change', applyFilters);
authorFilter.addEventListener('change', applyFilters);
actionableFilter.addEventListener('change', applyFilters);
exportBtn.addEventListener('click', exportMarkdown);

// Event listeners - Tab switching
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Event listeners - Authors Tab
authorSearchInput.addEventListener('input', applyAuthorFilters);
exportAuthorsBtn.addEventListener('click', exportAuthors);
importAuthorsFile.addEventListener('change', handleAuthorImport);

// Event listeners - Edit Author Modal
document.getElementById('closeEditModal').addEventListener('click', closeEditAuthorModal);
document.getElementById('cancelEditBtn').addEventListener('click', closeEditAuthorModal);
document.getElementById('saveAuthorBtn').addEventListener('click', saveAuthorFromModal);
document.getElementById('deleteAuthorBtn').addEventListener('click', deleteAuthor);

// Click outside modal to close
editAuthorModal.addEventListener('click', (e) => {
  if (e.target === editAuthorModal) closeEditAuthorModal();
});

// Initialize
loadTweets();
