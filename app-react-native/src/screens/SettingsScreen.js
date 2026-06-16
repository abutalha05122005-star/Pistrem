import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform
} from 'react-native';
import { getBackendUrl, saveBackendUrl, autoDiscoverServer } from '../config.js';
import { testConnection } from '../services/api.js';
import { checkForAppUpdates, performAppUpgrade, CLIENT_VERSION } from '../services/updateChecker.js';

export default function SettingsScreen({ onClose }) {
  const [urlInput, setUrlInput] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('unknown'); // 'unknown' | 'online' | 'unreachable'
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusLog, setScanStatusLog] = useState('');
  
  // Update state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  useEffect(() => {
    async function loadCurrentSettings() {
      const currentUrl = await getBackendUrl();
      setUrlInput(currentUrl);
      verifyConnection(currentUrl);
    }
    loadCurrentSettings();
  }, []);

  const verifyConnection = async (url) => {
    setIsTesting(true);
    setConnectionStatus('unknown');
    try {
      const isOnline = await testConnection(url);
      setConnectionStatus(isOnline ? 'online' : 'unreachable');
    } catch (e) {
      setConnectionStatus('unreachable');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!urlInput.trim()) {
      Alert.alert('Validation Error', 'Backend URL cannot be blank.');
      return;
    }
    try {
      const savedUrl = await saveBackendUrl(urlInput);
      setUrlInput(savedUrl);
      await verifyConnection(savedUrl);
      Alert.alert('Settings Saved', 'Backend server connection updated successfully.');
    } catch (e) {
      Alert.alert('Save Failed', e.message);
    }
  };

  const handleAutoDiscovery = async () => {
    setIsScanning(true);
    setScanStatusLog('Initializing discovery pipeline...');
    try {
      const discoveredUrl = await autoDiscoverServer((logMessage) => {
        setScanStatusLog(logMessage);
      });

      if (discoveredUrl) {
        setUrlInput(discoveredUrl);
        await saveBackendUrl(discoveredUrl);
        setConnectionStatus('online');
        setScanStatusLog('Server found and saved!');
        Alert.alert(
          'Pi Server Discovered!',
          `Successfully connected to PiStream service running at ${discoveredUrl}`
        );
      } else {
        setScanStatusLog('');
        Alert.alert(
          'Discovery Failed',
          'Could not find any PiStream servers on your current Wi-Fi subnets. Please check if your Pi is powered up and connected to the same Wi-Fi, or enter the IP address manually.'
        );
      }
    } catch (e) {
      setScanStatusLog('');
      Alert.alert('Discovery Error', 'Network socket error during IP scanning.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualUpdateCheck = async () => {
    setIsCheckingUpdate(true);
    setUpdateInfo(null);
    try {
      const info = await checkForAppUpdates();
      setUpdateInfo(info);
      if (info.hasUpdate) {
        Alert.alert(
          'Update Found!',
          `Version ${info.latestVersion} is available. Upgrade now?`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Upgrade Now', onPress: () => performAppUpgrade(info) }
          ]
        );
      } else if (info.error) {
        Alert.alert('Update Check Failed', 'The server is unreachable or offline.');
      } else {
        Alert.alert('Latest Version', `You are already running the newest version (v${CLIENT_VERSION}).`);
      }
    } catch (e) {
      Alert.alert('Upgrade Error', 'Could not query release updates.');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>System Settings</Text>
      
      {/* 🔮 SERVER PATH INPUT */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PiStream Server Base URL</Text>
        <TextInput
          style={styles.input}
          placeholder="http://192.168.1.100:3000"
          placeholderTextColor="#666"
          value={urlInput}
          onChangeText={setUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        
        {/* Connection test HUD */}
        <View style={styles.statusHud}>
          <Text style={styles.statusLabel}>Server Status: </Text>
          {isTesting ? (
            <ActivityIndicator size="small" color="#E50914" />
          ) : (
            <Text 
              style={[
                styles.statusValue, 
                connectionStatus === 'online' ? styles.onlineText : styles.offlineText
              ]}
            >
              {connectionStatus === 'online' 
                ? '🟢 Connected (Online)' 
                : connectionStatus === 'unreachable' 
                  ? '🔴 Unreachable' 
                  : '🟡 Testing...'}
            </Text>
          )}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={[styles.button, styles.secondaryButton, { flex: 1 }]} 
            onPress={() => verifyConnection(urlInput)}
            disabled={isTesting}
          >
            <Text style={styles.buttonText}>Test Ping</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.primaryButton, { flex: 1.2 }]} 
            onPress={handleSaveSettings}
            disabled={isTesting}
          >
            <Text style={styles.buttonText}>Save Changes</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 📡 LOCAL AUTO DISCOVERY */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Automated WiFi Discovery</Text>
        <Text style={styles.sectionDesc}>
          Scans your current local WiFi subnets in real-time to discover the PiStream streaming service running on your Raspberry Pi.
        </Text>
        
        {isScanning ? (
          <View style={styles.scanLogBlock}>
            <ActivityIndicator size="small" color="#4FAF50" />
            <Text style={styles.scanLogText}>{scanStatusLog}</Text>
          </View>
        ) : (
          <TouchableOpacity 
            style={[styles.button, styles.discoveryButton]} 
            onPress={handleAutoDiscovery}
          >
            <Text style={[styles.buttonText, { fontWeight: '700' }]}>🔍 Scan Local Network</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 🚀 CLIENT APP INFO & GIT EXTRAS */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Application Client Version</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Local Build:</Text>
          <Text style={styles.infoVal}>v{CLIENT_VERSION}</Text>
        </View>

        {updateInfo && updateInfo.hasUpdate && (
          <View style={styles.updateCard}>
            <Text style={styles.updateAvailableTitle}>🔥 New Version Available: v{updateInfo.latestVersion}</Text>
            <Text style={styles.updateNotes} numberOfLines={4}>{updateInfo.releaseNotes}</Text>
            <TouchableOpacity 
              style={[styles.button, styles.upgradeButton]} 
              onPress={() => performAppUpgrade(updateInfo)}
            >
              <Text style={styles.buttonText}>⬇️ Download & Sideload APK</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity 
          style={[styles.button, styles.secondaryButton, { marginTop: 10 }]} 
          onPress={handleManualUpdateCheck}
          disabled={isCheckingUpdate}
        >
          {isCheckingUpdate ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>🔄 Check for Releases</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* BACK / EXIT CONTROL */}
      <TouchableOpacity style={[styles.button, styles.closeButton]} onPress={onClose}>
        <Text style={styles.buttonText}>Return to Dashboard</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#0F0F0F',
    flex: 1
  },
  container: {
    padding: 18,
    paddingBottom: 40
  },
  title: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 20,
    letterSpacing: 1
  },
  section: {
    backgroundColor: '#161616',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#262626'
  },
  sectionLabel: {
    color: '#E50914',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  sectionDesc: {
    color: '#999',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16
  },
  input: {
    backgroundColor: '#202020',
    borderRadius: 6,
    color: '#FFFF',
    height: 48,
    paddingHorizontal: 16,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333'
  },
  statusHud: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 16
  },
  statusLabel: {
    color: '#888',
    fontSize: 13
  },
  statusValue: {
    fontWeight: '700',
    fontSize: 13
  },
  onlineText: {
    color: '#4FAF50'
  },
  offlineText: {
    color: '#E50914'
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10
  },
  button: {
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row'
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  primaryButton: {
    backgroundColor: '#E50914'
  },
  secondaryButton: {
    backgroundColor: '#2D2D2D',
    borderWidth: 1,
    borderColor: '#444'
  },
  discoveryButton: {
    backgroundColor: '#4FAF50'
  },
  upgradeButton: {
    backgroundColor: '#2196F3',
    marginTop: 10
  },
  scanLogBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#202020',
    borderRadius: 6,
    gap: 10
  },
  scanLogText: {
    color: '#4FAF50',
    fontSize: 12,
    fontWeight: '600'
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4
  },
  infoLabel: {
    color: '#888',
    fontSize: 13
  },
  infoVal: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700'
  },
  updateCard: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#1F2937',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3B82F6'
  },
  updateAvailableTitle: {
    color: '#3B82F6',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 6
  },
  updateNotes: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16
  },
  closeButton: {
    backgroundColor: '#212121',
    marginTop: 10,
    height: 50,
    borderWidth: 1,
    borderColor: '#333'
  }
});
