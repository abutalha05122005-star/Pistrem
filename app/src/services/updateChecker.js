import { Linking, Platform } from 'react-native';
import { getBackendUrl } from '../config.js';

// Holds local client version, compares against the GitHub release tag supplied by the server
export const CLIENT_VERSION = '1.0.0';

/**
 * Robust, dependency-free semantic version comparison
 * Returns true if incoming version is strictly greater than local version.
 */
export function isNewerVersion(local, incoming) {
  try {
    const parse = (v) => {
      // Clean string, e.g. "v1.2.0-beta" -> [1, 2, 0]
      const clean = v.replace(/^v/, '').split('-')[0];
      return clean.split('.').map(num => parseInt(num, 10) || 0);
    };
    
    const [localMajor, localMinor, localPatch] = parse(local);
    const [incomingMajor, incomingMinor, incomingPatch] = parse(incoming);
    
    if (incomingMajor !== localMajor) {
      return incomingMajor > localMajor;
    }
    if (incomingMinor !== localMinor) {
      return incomingMinor > localMinor;
    }
    return incomingPatch > localPatch;
  } catch (e) {
    console.warn('Semantic version parsing failed:', e.message);
    return false;
  }
}

/**
 * Contacts the PiStream server version endpoint, compares client version,
 * and retrieves download pointers.
 */
export async function checkForAppUpdates() {
  const backendUrl = await getBackendUrl();
  try {
    const response = await fetch(`${backendUrl}/api/version`, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`Server version check endpoint returned HTTP ${response.status}`);
    }
    
    const data = await response.json();
    if (data.success) {
      const hasUpdate = isNewerVersion(CLIENT_VERSION, data.latestVersion);
      return {
        hasUpdate,
        currentVersion: CLIENT_VERSION,
        latestVersion: data.latestVersion,
        releaseNotes: data.releaseNotes || 'No release details supplied.',
        apkUrl: data.apkUrl,
        assets: data.assets || []
      };
    }
    return { hasUpdate: false, currentVersion: CLIENT_VERSION };
  } catch (err) {
    console.warn('[Auto-Updater] Check failed:', err.message);
    return {
      hasUpdate: false,
      currentVersion: CLIENT_VERSION,
      error: 'Unreachable update server'
    };
  }
}

/**
 * Triggers the client upgrade pipeline.
 * On Android, directs the user to download the APK.
 * On iOS, directs them to download/use appropriate link or OTA flow if applicable.
 */
export async function performAppUpgrade(updateInfo) {
  if (!updateInfo || !updateInfo.hasUpdate) {
    return false;
  }
  
  const downloadUrl = Platform.OS === 'android' 
    ? (updateInfo.apkUrl || 'https://github.com/abutalha0512/pistream/releases')
    : 'https://github.com/abutalha0512/pistream'; // Fallback to release page for iOS
    
  try {
    const supported = await Linking.canOpenURL(downloadUrl);
    if (supported) {
      // Trigger default system browser to securely handle APK downloads and installation warnings
      await Linking.openURL(downloadUrl);
      return true;
    } else {
      throw new Error('Link is not openable by device operating system.');
    }
  } catch (e) {
    console.error('[Auto-Updater] Upgrade trigger error:', e.message);
    return false;
  }
}
