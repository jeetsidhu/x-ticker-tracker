// X Tweet Tracker - Content Script
// Injects save buttons into tweets for documentation

const TICKER_REGEX = /\$([A-Z]{1,5})\b/g;
const PROCESSED_ATTR = 'data-ticker-tracker-processed';

// Modal state
let saveModal = null;
let currentTweetData = null;

// Extract tickers from text
function extractTickers(text) {
  const matches = text.match(TICKER_REGEX);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1)))]; // Remove $ and dedupe
}

// Create save modal
function createSaveModal() {
  const modal = document.createElement('div');
  modal.className = 'ticker-tracker-modal-overlay';
  modal.innerHTML = `
    <div class="ticker-tracker-modal">
      <div class="ticker-modal-header">
        <h3>Save Tweet</h3>
        <button class="ticker-modal-close">&times;</button>
      </div>
      <div class="ticker-modal-preview">
        <div class="ticker-modal-author"></div>
        <div class="ticker-modal-text"></div>
        <div class="ticker-modal-tickers"></div>
      </div>
      <div class="ticker-modal-author-section">
        <div class="ticker-author-section-header">
          <span class="ticker-author-section-title">Author Info</span>
          <button class="ticker-author-toggle" type="button">
            <svg class="toggle-icon" viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M7 10l5 5 5-5z"/>
            </svg>
          </button>
        </div>
        <div class="ticker-author-section-content">
          <div class="ticker-author-tags-group">
            <div class="ticker-author-existing-tags">
              <span class="ticker-author-label">Current Tags:</span>
              <div class="ticker-author-tags-display"></div>
            </div>
            <div class="ticker-author-input-group">
              <label for="ticker-author-tags">Tags (comma-separated)</label>
              <input type="text" id="ticker-author-tags" placeholder="e.g., biotech, small caps, options">
            </div>
          </div>
          <div class="ticker-author-notes-group">
            <div class="ticker-author-existing-notes">
              <span class="ticker-author-label">Current Notes:</span>
              <div class="ticker-author-notes-display"></div>
            </div>
            <div class="ticker-author-input-group">
              <label for="ticker-author-notes">Notes about this author</label>
              <textarea id="ticker-author-notes" placeholder="e.g., Known for accurate biotech predictions"></textarea>
            </div>
          </div>
          <div class="ticker-author-previous-tweets">
            <span class="ticker-author-label">Previous Tweets (<span class="prev-tweet-count">0</span>):</span>
            <div class="ticker-author-tweets-list"></div>
          </div>
        </div>
      </div>
      <div class="ticker-modal-form">
        <label class="ticker-modal-checkbox-label">
          <input type="checkbox" id="ticker-actionable-checkbox">
          <span class="checkmark"></span>
          Actionable Trade
        </label>
        <div class="ticker-modal-comment-group">
          <label for="ticker-comment">Comment (optional)</label>
          <textarea id="ticker-comment" placeholder="Add your notes about this tweet..."></textarea>
        </div>
      </div>
      <div class="ticker-modal-footer">
        <button class="ticker-modal-btn ticker-modal-cancel">Cancel</button>
        <button class="ticker-modal-btn ticker-modal-save">Save Tweet</button>
      </div>
    </div>
  `;

  // Close button handler
  modal.querySelector('.ticker-modal-close').addEventListener('click', closeSaveModal);
  modal.querySelector('.ticker-modal-cancel').addEventListener('click', closeSaveModal);

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSaveModal();
  });

  // Save button handler
  modal.querySelector('.ticker-modal-save').addEventListener('click', handleModalSave);

  // Author section toggle
  modal.querySelector('.ticker-author-toggle').addEventListener('click', () => {
    const section = modal.querySelector('.ticker-modal-author-section');
    section.classList.toggle('collapsed');
  });

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && saveModal?.classList.contains('visible')) {
      closeSaveModal();
    }
  });

  document.body.appendChild(modal);
  return modal;
}

// Get or create save modal
function getSaveModal() {
  if (!saveModal) {
    saveModal = createSaveModal();
  }
  return saveModal;
}

// Show save modal
async function showSaveModal(tweetData, button) {
  currentTweetData = { ...tweetData, saveButton: button };

  const modal = getSaveModal();

  // Populate preview
  modal.querySelector('.ticker-modal-author').textContent = `@${tweetData.author}`;
  modal.querySelector('.ticker-modal-text').textContent = tweetData.text.length > 200
    ? tweetData.text.substring(0, 200) + '...'
    : tweetData.text;
  modal.querySelector('.ticker-modal-tickers').innerHTML = tweetData.tickers.length > 0
    ? tweetData.tickers.map(t => `<span class="ticker-tag">$${t}</span>`).join('')
    : '<span class="no-tickers">No tickers detected</span>';

  // Reset form
  modal.querySelector('#ticker-actionable-checkbox').checked = false;
  modal.querySelector('#ticker-comment').value = '';

  // Reset author section
  modal.querySelector('.ticker-author-tags-display').innerHTML = '<span class="no-data">No tags yet</span>';
  modal.querySelector('.ticker-author-notes-display').innerHTML = '<span class="no-data">No notes yet</span>';
  modal.querySelector('.ticker-author-tweets-list').innerHTML = '';
  modal.querySelector('.prev-tweet-count').textContent = '0';
  modal.querySelector('#ticker-author-tags').value = '';
  modal.querySelector('#ticker-author-notes').value = '';

  // Fetch author data and previous tweets
  if (tweetData.author) {
    try {
      const [authorResponse, tweetsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_AUTHOR_TAG', handle: tweetData.author }),
        chrome.runtime.sendMessage({ type: 'GET_TWEETS_BY_AUTHOR', handle: tweetData.author })
      ]);

      // Populate existing author tags
      if (authorResponse?.author) {
        const author = authorResponse.author;

        if (author.tags && author.tags.length > 0) {
          modal.querySelector('.ticker-author-tags-display').innerHTML =
            author.tags.map(t => `<span class="author-tag-badge">${escapeHtml(t)}</span>`).join('');
          modal.querySelector('#ticker-author-tags').value = author.tags.join(', ');
        }

        if (author.notes) {
          modal.querySelector('.ticker-author-notes-display').innerHTML = escapeHtml(author.notes);
          modal.querySelector('#ticker-author-notes').value = author.notes;
        }
      }

      // Populate previous tweets
      if (tweetsResponse?.tweets && tweetsResponse.tweets.length > 0) {
        const prevTweets = tweetsResponse.tweets.slice(0, 5);
        modal.querySelector('.prev-tweet-count').textContent = tweetsResponse.tweets.length;
        modal.querySelector('.ticker-author-tweets-list').innerHTML = prevTweets.map(t => `
          <div class="prev-tweet-item">
            <div class="prev-tweet-text">${escapeHtml(t.text.substring(0, 100))}${t.text.length > 100 ? '...' : ''}</div>
            <div class="prev-tweet-meta">
              ${t.tickers.length > 0 ? t.tickers.map(ticker => `<span class="prev-tweet-ticker">$${ticker}</span>`).join('') : ''}
              <span class="prev-tweet-date">${formatRelativeDate(t.savedAt)}</span>
            </div>
          </div>
        `).join('');
      }
    } catch (error) {
      console.error('Error fetching author data:', error);
    }
  }

  // Show modal
  modal.classList.add('visible');
  modal.querySelector('#ticker-comment').focus();
}

// Escape HTML for display
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Format relative date
function formatRelativeDate(isoString) {
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

// Close save modal
function closeSaveModal() {
  const modal = getSaveModal();
  modal.classList.remove('visible');
  currentTweetData = null;
}

// Generate and download markdown file to subfolder
function downloadMarkdown(tweetData) {
  const now = new Date();
  const captureDateFormatted = now.toLocaleString();

  const tweetTimeFormatted = tweetData.tweetedAt
    ? new Date(tweetData.tweetedAt).toLocaleString()
    : 'Unknown';

  let markdown = `# Saved Tweet\n\n`;
  markdown += `## Metadata\n`;
  markdown += `- **Captured:** ${captureDateFormatted}\n`;
  markdown += `- **Tweet Time:** ${tweetTimeFormatted}\n`;
  markdown += `- **Author:** @${tweetData.author}`;
  if (tweetData.authorDisplayName) {
    markdown += ` (${tweetData.authorDisplayName})`;
  }
  markdown += `\n`;
  markdown += `- **Tickers:** ${tweetData.tickers.length > 0 ? tweetData.tickers.map(t => `$${t}`).join(', ') : 'None'}\n`;
  markdown += `- **Actionable Trade:** ${tweetData.actionable ? 'Yes' : 'No'}\n`;
  markdown += `- **URL:** ${tweetData.url}\n`;
  markdown += `\n`;

  markdown += `## Tweet Content\n\n`;
  markdown += `> ${tweetData.text.split('\n').join('\n> ')}\n\n`;

  if (tweetData.images && tweetData.images.length > 0) {
    markdown += `## Images\n\n`;
    tweetData.images.forEach((imgUrl, index) => {
      markdown += `![Image ${index + 1}](${imgUrl})\n\n`;
    });
  }

  if (tweetData.comment) {
    markdown += `## Notes\n\n`;
    markdown += `${tweetData.comment}\n\n`;
  }

  markdown += `---\n`;
  markdown += `*Saved with X Tweet Tracker*\n`;

  // Generate filename with subfolder
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const tickerStr = tweetData.tickers.length > 0 ? `_${tweetData.tickers.slice(0, 3).join('-')}` : '';
  const filename = `tweet-tracker-tweets/tweet_${tweetData.author}${tickerStr}_${dateStr}_${timeStr}.md`;

  // Send to background script for download
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_MARKDOWN',
    markdown: markdown,
    filename: filename
  });
}

// Handle modal save button
async function handleModalSave() {
  if (!currentTweetData) return;

  const modal = getSaveModal();
  const actionable = modal.querySelector('#ticker-actionable-checkbox').checked;
  const comment = modal.querySelector('#ticker-comment').value.trim();
  const button = currentTweetData.saveButton;

  // Get author tags/notes
  const authorTagsInput = modal.querySelector('#ticker-author-tags').value.trim();
  const authorNotes = modal.querySelector('#ticker-author-notes').value.trim();
  const authorTags = authorTagsInput
    ? authorTagsInput.split(',').map(t => t.trim()).filter(t => t)
    : [];

  // Add form data to tweet data
  const tweetDataWithComments = {
    ...currentTweetData,
    actionable,
    comment
  };
  delete tweetDataWithComments.saveButton;

  // Close modal
  closeSaveModal();

  if (button) {
    button.classList.add('saving');
  }

  try {
    // Save author tags if any were entered
    if (currentTweetData.author && (authorTags.length > 0 || authorNotes)) {
      await chrome.runtime.sendMessage({
        type: 'SAVE_AUTHOR_TAG',
        data: {
          handle: currentTweetData.author,
          displayName: currentTweetData.authorDisplayName,
          tags: authorTags,
          notes: authorNotes
        }
      });
    }

    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_TWEET',
      data: tweetDataWithComments
    });

    if (!response) {
      throw new Error('No response from background script');
    }

    if (response.success) {
      if (button) {
        button.classList.remove('saving');
        button.classList.add('saved');
      }
      // Download markdown file
      downloadMarkdown(tweetDataWithComments);
      showNotification(`Saved! Tickers: ${tweetDataWithComments.tickers.length > 0 ? tweetDataWithComments.tickers.join(', ') : 'None detected'}`, 'success');
    } else if (response.duplicate) {
      if (button) {
        button.classList.remove('saving');
        button.classList.add('saved');
      }
      showNotification('Tweet already saved', 'info');
    } else if (response.error) {
      if (button) {
        button.classList.remove('saving');
      }
      showNotification(`Failed: ${response.error}`, 'error');
    } else {
      if (button) {
        button.classList.remove('saving');
      }
      showNotification('Failed to save tweet', 'error');
    }
  } catch (error) {
    if (button) {
      button.classList.remove('saving');
    }
    showNotification('Error saving tweet', 'error');
    console.error('Tweet Tracker:', error);
  }
}

// Get tweet data from a tweet element
function getTweetData(tweetElement) {
  // Find the tweet article
  const article = tweetElement.closest('article[data-testid="tweet"]') || tweetElement;

  // Get tweet text
  const tweetTextElement = article.querySelector('[data-testid="tweetText"]');
  const text = tweetTextElement ? tweetTextElement.textContent : '';

  // Get author info
  const userNameElement = article.querySelector('[data-testid="User-Name"]');
  let author = '';
  let authorDisplayName = '';

  if (userNameElement) {
    const links = userNameElement.querySelectorAll('a');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('/') && !href.includes('/status/')) {
        author = href.slice(1); // Remove leading /
      }
    });

    const displayNameSpan = userNameElement.querySelector('span');
    if (displayNameSpan) {
      authorDisplayName = displayNameSpan.textContent;
    }
  }

  // Get tweet URL and ID - try multiple methods
  let url = '';
  let id = '';
  let tweetedAt = null;

  // Method 1: Try time element's parent link
  const timeElement = article.querySelector('time');
  if (timeElement) {
    // Extract tweet datetime
    const datetime = timeElement.getAttribute('datetime');
    if (datetime) {
      tweetedAt = datetime;
    }

    const timeLink = timeElement.closest('a');
    if (timeLink) {
      const href = timeLink.getAttribute('href');
      if (href && href.includes('/status/')) {
        url = `https://x.com${href}`;
        const statusMatch = href.match(/\/status\/(\d+)/);
        if (statusMatch) {
          id = statusMatch[1];
        }
      }
    }
  }

  // Method 2: Find any link with /status/ in the article
  if (!id) {
    const allLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      const statusMatch = href.match(/\/status\/(\d+)/);
      if (statusMatch) {
        id = statusMatch[1];
        // Extract author from the link if we don't have it
        const authorMatch = href.match(/^\/([^/]+)\/status\//);
        if (authorMatch && !author) {
          author = authorMatch[1];
        }
        url = `https://x.com${href}`;
        break;
      }
    }
  }

  // Method 3: Check current page URL if viewing a single tweet
  if (!id && window.location.pathname.includes('/status/')) {
    const pageMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (pageMatch) {
      id = pageMatch[1];
      url = window.location.href.split('?')[0]; // Remove query params
      // Extract author from URL
      const authorMatch = window.location.pathname.match(/^\/([^/]+)\/status\//);
      if (authorMatch && !author) {
        author = authorMatch[1];
      }
    }
  }

  // Method 4: Look for analytics link or share button data
  if (!id) {
    const analyticsLink = article.querySelector('a[href*="/analytics"]');
    if (analyticsLink) {
      const href = analyticsLink.getAttribute('href');
      const match = href.match(/\/status\/(\d+)/);
      if (match) {
        id = match[1];
        if (author) {
          url = `https://x.com/${author}/status/${id}`;
        }
      }
    }
  }

  const tickers = extractTickers(text);

  // Extract image URLs from tweet
  const images = [];
  const mediaContainer = article.querySelector('[data-testid="tweetPhoto"]')?.closest('div[aria-labelledby]') || article;
  const imgElements = mediaContainer.querySelectorAll('img[src*="pbs.twimg.com/media"]');
  imgElements.forEach(img => {
    let imgUrl = img.src;
    // Get the highest quality version by modifying the URL
    if (imgUrl.includes('?')) {
      imgUrl = imgUrl.split('?')[0] + '?format=jpg&name=large';
    }
    if (!images.includes(imgUrl)) {
      images.push(imgUrl);
    }
  });

  return {
    id,
    url,
    text,
    author,
    authorDisplayName,
    tickers,
    images,
    tweetedAt,
    savedAt: new Date().toISOString()
  };
}

// Create save button
function createSaveButton(tweetElement) {
  const button = document.createElement('button');
  button.className = 'ticker-tracker-save-btn';
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
    </svg>
  `;
  button.title = 'Save to Tweet Tracker';

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const tweetData = getTweetData(tweetElement);

    if (!tweetData.id) {
      showNotification('Could not extract tweet data', 'error');
      return;
    }

    // Show modal for adding comments
    showSaveModal(tweetData, button);
  });

  return button;
}

// Show notification toast
function showNotification(message, type = 'info') {
  const existing = document.querySelector('.ticker-tracker-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = `ticker-tracker-notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Process a single tweet
function processTweet(tweetElement) {
  if (tweetElement.hasAttribute(PROCESSED_ATTR)) return;

  const actionBar = tweetElement.querySelector('[role="group"]');
  if (!actionBar) return;

  // Check if we already have a button in this action bar
  if (actionBar.querySelector('.ticker-tracker-save-btn')) return;

  tweetElement.setAttribute(PROCESSED_ATTR, 'true');

  const button = createSaveButton(tweetElement);
  const buttonWrapper = document.createElement('div');
  buttonWrapper.className = 'ticker-tracker-btn-wrapper';
  buttonWrapper.appendChild(button);

  actionBar.appendChild(buttonWrapper);
}

// Find and process all tweets
function processAllTweets() {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  tweets.forEach(processTweet);
}

// Set up MutationObserver for dynamically loaded tweets
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
      // Debounce processing
      clearTimeout(window.tweetTrackerTimeout);
      window.tweetTrackerTimeout = setTimeout(processAllTweets, 100);
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
  console.log('X Tweet Tracker initialized');
}

// Wait for page to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
