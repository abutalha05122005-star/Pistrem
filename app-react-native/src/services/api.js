import { getBackendUrl } from '../config.js';

/**
 * Enhanced fetch with built-in retry mechanism and dynamic URL resolution
 */
async function fetchWithRetry(endpoint, options = {}, retries = 3, delayMs = 1000) {
  const backendUrl = await getBackendUrl();
  const url = endpoint.startsWith('http') ? endpoint : `${backendUrl}${endpoint}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), options.timeout || 10000); // 10s default timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      
      clearTimeout(id);
      
      if (!response.ok) {
        throw new Error(`Server returned HTTP status ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      if (attempt === retries) {
        console.error(`[API] Failed after ${retries} attempts:`, err.message);
        throw err;
      }
      console.warn(`[API] Attempt ${attempt} failed. Retrying in ${delayMs}ms... Error: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Checks if the current backend server is reachable and active.
 */
export async function testConnection(customUrl = null) {
  const base = customUrl || (await getBackendUrl());
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500); // 3.5s timeout for health checks
    
    const res = await fetch(`${base}/`, { signal: controller.signal });
    clearTimeout(timeout);
    
    const text = await res.text();
    return text.includes('PiStream Server is Running!');
  } catch (e) {
    return false;
  }
}

/**
 * Searches torrent files on the backend
 */
export async function searchTorrents(query, type = 'all', season = null, episode = null) {
  return fetchWithRetry('/api/search', {
    method: 'POST',
    body: JSON.stringify({ query, type, season, episode }),
    timeout: 12000 // Multi-scraper searches may require longer timeouts
  });
}

/**
 * Saves current playing video progress
 */
export async function syncProgress(progressData) {
  // { id, tmdbId, title, type, position, duration }
  return fetchWithRetry('/api/progress', {
    method: 'POST',
    body: JSON.stringify(progressData),
    timeout: 4000
  });
}

/**
 * Fetches saved watchlist from server
 */
export async function getWatchlist() {
  return fetchWithRetry('/api/watchlist', { method: 'GET' });
}

/**
 * Saves a media item to Watchlist
 */
export async function addToWatchlist(mediaItem) {
  return fetchWithRetry('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify(mediaItem)
  });
}

/**
 * Removes a media item from Watchlist
 */
export async function removeFromWatchlist(id) {
  return fetchWithRetry(`/api/watchlist/${id}`, { method: 'DELETE' });
}

/**
 * Fetches resume details for a specific media item ID
 */
export async function getMediaProgress(id) {
  return fetchWithRetry(`/api/progress/${id}`, { method: 'GET' });
}

/**
 * Fetches movies under Continue Watching
 */
export async function getContinueWatching() {
  return fetchWithRetry('/api/continue-watching', { method: 'GET' });
}

/**
 * Sends request to manually teardown streaming session to save Raspberry Pi RAM/storage
 */
export async function stopStreamSession(id) {
  return fetchWithRetry(`/api/stop/${id}`, { method: 'DELETE' });
}

/**
 * Retrieves the operational cache and server metrics for dashboard stats
 */
export async function getServerStatus() {
  return fetchWithRetry('/api/status', { method: 'GET', timeout: 4000 });
}

/**
 * Retrieves the real-time Raspberry Pi hardware utilization stats
 */
export async function getSystemStats() {
  return fetchWithRetry('/api/system/stats', { method: 'GET', timeout: 4000 });
}
