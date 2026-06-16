import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@pistream_backend_url';
export const DEFAULT_SERVER_IP = '192.168.68.102';
export const DEFAULT_BACKEND_URL = `http://${DEFAULT_SERVER_IP}:3000`; // Static primary IP

/**
 * Loads the current configured backend server URL from persistent store
 */
export async function getBackendUrl() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    return saved || DEFAULT_BACKEND_URL;
  } catch (e) {
    return DEFAULT_BACKEND_URL;
  }
}

/**
 * Persists the specified backend URL in AsyncStorage
 */
export async function saveBackendUrl(url) {
  try {
    // Sanitize URL (remove trailing slashes, ensure correct scheme)
    let sanitized = url.trim();
    if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
      sanitized = 'http://' + sanitized;
    }
    if (sanitized.endsWith('/')) {
      sanitized = sanitized.slice(0, -1);
    }
    await AsyncStorage.setItem(STORAGE_KEY, sanitized);
    return sanitized;
  } catch (e) {
    throw new Error('Failed to save connection setting persistently.');
  }
}

