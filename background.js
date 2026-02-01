// X Tweet Tracker - Background Service Worker
// Handles storage operations for saved tweets

const STORAGE_KEY = 'savedTweets';
const AUTHOR_TAGS_KEY = 'authorTags';

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

  // Update author tweet count
  if (tweetData.author) {
    await updateAuthorTweetCount(tweetData.author);
  }

  return { success: true };
}

// Delete a tweet by ID
async function deleteTweet(tweetId) {
  const tweets = await getSavedTweets();
  const tweetToDelete = tweets.find(t => t.id === tweetId);
  const filtered = tweets.filter(t => t.id !== tweetId);
  await saveTweets(filtered);

  // Update author tweet count after deletion
  if (tweetToDelete && tweetToDelete.author) {
    await updateAuthorTweetCount(tweetToDelete.author);
  }

  return { success: true };
}

// Author Tags Functions

// Get all author tags
async function getAuthorTags() {
  const result = await chrome.storage.local.get(AUTHOR_TAGS_KEY);
  return result[AUTHOR_TAGS_KEY] || {};
}

// Get single author's tags
async function getAuthorTag(handle) {
  const tags = await getAuthorTags();
  return tags[handle] || null;
}

// Save/update author tags
async function saveAuthorTag(data) {
  const tags = await getAuthorTags();
  const existing = tags[data.handle] || {};

  tags[data.handle] = {
    handle: data.handle,
    displayName: data.displayName || existing.displayName || data.handle,
    tags: data.tags || existing.tags || [],
    notes: data.notes !== undefined ? data.notes : (existing.notes || ''),
    tweetCount: existing.tweetCount || 0,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [AUTHOR_TAGS_KEY]: tags });
  return { success: true, author: tags[data.handle] };
}

// Delete author tags
async function deleteAuthorTag(handle) {
  const tags = await getAuthorTags();
  delete tags[handle];
  await chrome.storage.local.set({ [AUTHOR_TAGS_KEY]: tags });
  return { success: true };
}

// Get tweets by specific author
async function getTweetsByAuthor(handle) {
  const tweets = await getSavedTweets();
  return tweets.filter(t => t.author === handle);
}

// Update author tweet count
async function updateAuthorTweetCount(handle) {
  if (!handle) return;

  const tweets = await getTweetsByAuthor(handle);
  const tags = await getAuthorTags();

  if (tags[handle]) {
    tags[handle].tweetCount = tweets.length;
    tags[handle].updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [AUTHOR_TAGS_KEY]: tags });
  } else if (tweets.length > 0) {
    // Auto-create author entry when saving first tweet
    const firstTweet = tweets[0];
    tags[handle] = {
      handle: handle,
      displayName: firstTweet.authorDisplayName || handle,
      tags: [],
      notes: '',
      tweetCount: tweets.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTHOR_TAGS_KEY]: tags });
  }
}

// Export author tags to JSON
function exportAuthorTagsToJson(authorTags) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: 1,
    authorTags: authorTags
  }, null, 2);
}

// Import author tags from JSON
async function importAuthorTags(jsonData, merge = true) {
  try {
    const imported = JSON.parse(jsonData);
    if (!imported.authorTags) {
      return { success: false, error: 'Invalid format: missing authorTags' };
    }

    if (merge) {
      const existing = await getAuthorTags();
      // Merge: imported data takes precedence for conflicts
      const merged = { ...existing, ...imported.authorTags };
      await chrome.storage.local.set({ [AUTHOR_TAGS_KEY]: merged });
      return { success: true, count: Object.keys(imported.authorTags).length, merged: true };
    } else {
      await chrome.storage.local.set({ [AUTHOR_TAGS_KEY]: imported.authorTags });
      return { success: true, count: Object.keys(imported.authorTags).length, merged: false };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
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
  let markdown = '# Saved Tweets\n\n';
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
    if (tweet.images && tweet.images.length > 0) {
      tweet.images.forEach((imgUrl, index) => {
        markdown += `![Image ${index + 1}](${imgUrl})\n\n`;
      });
    }
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

      case 'DOWNLOAD_MARKDOWN':
        try {
          // Use data URL instead of blob URL (blob URLs don't work in service workers)
          const dataUrl = 'data:text/markdown;base64,' + btoa(unescape(encodeURIComponent(message.markdown)));
          await chrome.downloads.download({
            url: dataUrl,
            filename: message.filename,
            saveAs: false
          });
          return { success: true };
        } catch (error) {
          console.error('Download error:', error);
          return { success: false, error: error.message };
        }

      // Author tag handlers
      case 'GET_AUTHOR_TAGS':
        return { authorTags: await getAuthorTags() };

      case 'GET_AUTHOR_TAG':
        return { author: await getAuthorTag(message.handle) };

      case 'SAVE_AUTHOR_TAG':
        return await saveAuthorTag(message.data);

      case 'DELETE_AUTHOR_TAG':
        return await deleteAuthorTag(message.handle);

      case 'GET_TWEETS_BY_AUTHOR':
        return { tweets: await getTweetsByAuthor(message.handle) };

      case 'EXPORT_AUTHOR_TAGS':
        const authorTags = await getAuthorTags();
        return { json: exportAuthorTagsToJson(authorTags) };

      case 'IMPORT_AUTHOR_TAGS':
        return await importAuthorTags(message.json, message.merge !== false);

      case 'DOWNLOAD_AUTHOR_TAGS':
        try {
          const jsonDataUrl = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(message.json)));
          await chrome.downloads.download({
            url: jsonDataUrl,
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

console.log('X Tweet Tracker background service worker initialized');
