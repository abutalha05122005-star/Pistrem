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

/**
 * Auto-discovery backup if static IP fails.
 * Scans subnet of the client.
 */
export async function autoDiscoverServer(onProgress) {
  let expoNetwork;
  try {
    // Dynamically require expo-network to prevent crash if not installed
    expoNetwork = require('expo-network');
  } catch(e) {
    if (onProgress) onProgress('expo-network not available. Using common subnets...');
  }
  
  const commonSubnets = ['192.168.68', '192.168.1', '192.168.0', '192.168.43', '10.0.0'];
  let subnetsToScan = [...commonSubnets];

  if (expoNetwork) {
    try {
      const ip = await expoNetwork.getIpAddressAsync();
      if (ip && ip.includes('.')) {
        const subnet = ip.substring(0, ip.lastIndexOf('.'));
        if (!commonSubnets.includes(subnet)) {
          subnetsToScan.unshift(subnet);
        } else {
          // move it to front
          subnetsToScan = subnetsToScan.filter(s => s !== subnet);
          subnetsToScan.unshift(subnet);
        }
      }
    } catch(e) {}
  }

  // Commonly leased host address pools from .2 to .254
  const hosts = Array.from({ length: 253 }, (_, i) => i + 2);
  const ports = [3000];
  
  if (onProgress) onProgress('Beginning local PiStream discovery...');
  
  for (const subnet of subnetsToScan) {
    if (onProgress) onProgress(`Probing subnet ${subnet}.x ...`);
    
    // Scan in batches of 15 in parallel 
    const batchSize = 15;
    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      
      const probePromises = batch.map(async (host) => {
        const ip = `${subnet}.${host}`;
        for (const port of ports) {
          const url = `http://${ip}:${port}`;
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 400);
            
            const res = await fetch(`${url}/api/discover`, { signal: controller.signal });
            clearTimeout(timeout);
            
            const data = await res.json();
            if (data && data.service === 'pistream') {
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
