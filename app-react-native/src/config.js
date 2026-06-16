import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@pistream_backend_url';
export const DEFAULT_BACKEND_URL = 'http://192.168.1.100:3000'; // Default guess which user can change

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

/**
 * Scans typical local networks in parallel to automatically discover the PiStream Pi Server.
 * Looks for servers serving the custom greet message of PiStream on Port 3000 or fallback 3001.
 */
export async function autoDiscoverServer(onProgress) {
  const commonSubnets = ['192.168.1', '192.168.0', '192.168.43', '10.0.0'];
  // Commonly leased host address pools from .2 to .150
  const hosts = Array.from({ length: 149 }, (_, i) => i + 2);
  const ports = [3000, 3001];
  
  if (onProgress) onProgress('Beginning local PiStream discovery...');
  
  for (const subnet of commonSubnets) {
    if (onProgress) onProgress(`Probing subnet ${subnet}.x ...`);
    
    // Scan in batches of 40 in parallel to prevent flooding mobile sockets
    const batchSize = 45;
    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      
      const probePromises = batch.map(async (host) => {
        const ip = `${subnet}.${host}`;
        for (const port of ports) {
          const url = `http://${ip}:${port}`;
          try {
            // Very fast timeout so the subnet scan is incredibly snappy
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 250);
            
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            
            const text = await res.text();
            if (text && text.includes('PiStream Server is Running!')) {
              return url;
            }
          } catch (e) {
            // Connection refused / timed out is ignored
          }
        }
        return null;
      });
      
      const results = await Promise.all(probePromises);
      const foundUrl = results.find(r => r !== null);
      if (foundUrl) {
        return foundUrl;
      }
    }
  }
  
  return null;
}
