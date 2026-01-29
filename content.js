// X Stock Ticker Tracker - Content Script
// Injects save buttons into tweets and detects stock tickers

const TICKER_REGEX = /\$([A-Z]{1,5})\b/g;
const PROCESSED_ATTR = 'data-ticker-tracker-processed';
const TICKER_PROCESSED_ATTR = 'data-ticker-hover-processed';

// Tooltip state
let activeTooltip = null;
let tooltipTimeout = null;
let hideTimeout = null;

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
function showSaveModal(tweetData, button) {
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

  // Show modal
  modal.classList.add('visible');
  modal.querySelector('#ticker-comment').focus();
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
  markdown += `*Saved with X Stock Ticker Tracker*\n`;

  // Generate filename with subfolder
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const tickerStr = tweetData.tickers.length > 0 ? `_${tweetData.tickers.slice(0, 3).join('-')}` : '';
  const filename = `ticker-tracker-tweets/tweet_${tweetData.author}${tickerStr}_${dateStr}_${timeStr}.md`;

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
    console.error('Ticker Tracker:', error);
  }
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
    <div class="ticker-tooltip-price">
      Share price: <span class="ticker-tooltip-current"></span>
    </div>
    <div class="ticker-tooltip-performance">
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

  // Fetch stock info
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

  if (!stockInfo || stockInfo.error) {
    tooltip.querySelector('.ticker-tooltip-symbol').textContent = `$${symbol}`;
    tooltip.querySelector('.ticker-tooltip-name').textContent = '';
    tooltip.querySelector('.ticker-tooltip-price').style.display = 'none';
    tooltip.querySelector('.ticker-tooltip-performance').style.display = 'none';
    tooltip.querySelector('.ticker-tooltip-link').href = `https://finance.yahoo.com/quote/${symbol}`;
    return;
  }

  // Populate tooltip
  tooltip.querySelector('.ticker-tooltip-symbol').textContent = `$${stockInfo.symbol}`;
  tooltip.querySelector('.ticker-tooltip-name').textContent = stockInfo.name;
  tooltip.querySelector('.ticker-tooltip-current').textContent = `$${stockInfo.priceFormatted}`;

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

  tooltip.querySelector('.ticker-tooltip-price').style.display = 'block';
  tooltip.querySelector('.ticker-tooltip-performance').style.display = 'flex';
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
  button.title = 'Save to Ticker Tracker';

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
  // Wrap tickers for hover (always try this)
  wrapTickersInTweet(tweetElement);

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
  console.log('X Stock Ticker Tracker initialized');
}

// Wait for page to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
