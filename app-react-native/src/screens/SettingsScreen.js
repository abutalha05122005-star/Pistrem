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
import { testConnection, getSystemStats } from '../services/api.js';
import { checkForAppUpdates, performAppUpgrade, CLIENT_VERSION } from '../services/updateChecker.js';

function formatUptime(seconds) {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function SettingsScreen({ onClose }) {
  const [urlInput, setUrlInput] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('unknown'); // 'unknown' | 'online' | 'unreachable'
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusLog, setScanStatusLog] = useState('');
  
  // Real-time system monitoring state
  const [stats, setStats] = useState(null);
  
  // Update state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  // Compute server health metrics summary based on CPU, RAM, and temperature thresholds
  const health = stats ? (() => {
    const cpu = stats.cpuUsage || 0;
    const ramRatio = stats.memoryTotal > 0 ? (stats.memoryUsed / stats.memoryTotal) : 0;
    const temp = stats.cpuTemp || 0;

    if (cpu >= 90 || ramRatio >= 0.95 || temp >= 80) {
      return {
        label: 'CRITICAL',
        color: '#E50914',
        desc: 'Server is under extreme stress. Thermal throttling or memory exhaustion imminent.'
      };
    }
    if (cpu >= 75 || ramRatio >= 0.85 || temp >= 72) {
      return {
        label: 'WARNING',
        color: '#FF9800',
        desc: 'Elevated resource load detected. Consider closing active streams.'
      };
    }
    return {
      label: 'HEALTHY',
      color: '#4FAF50',
      desc: 'All systems operational. CPU temperature and resource levels are optimal.'
    };
  })() : { label: 'Unknown', color: '#888', desc: 'Awaiting telemetry metrics...' };

  useEffect(() => {
    let intervalId;
    
    const fetchStats = async () => {
      if (connectionStatus === 'online') {
        try {
          const data = await getSystemStats();
          setStats(data);
        } catch (err) {
          console.warn('[Diagnostics Error] Failed to update stats:', err.message);
        }
      } else {
        setStats(null);
      }
    };

    fetchStats();
    intervalId = setInterval(fetchStats, 5000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [connectionStatus]);

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
      
      {/* 🔮 SERVER PATH DISPLAY */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PiStream Server Configured</Text>
        <Text style={styles.inputReadOnly}>
          {urlInput || 'Not Configured'}
        </Text>
        
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
            <Text style={styles.buttonText}>Check Connection Ping</Text>
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

      {/* 📊 RASPBERRY PI REAL-TIME SYSTEM MONITORING DASHBOARD */}
      {connectionStatus === 'online' && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Raspberry Pi Diagnostics</Text>
          <Text style={styles.sectionDesc}>
            Live hardware resource utilization and health indicators retrieved directly from your host device.
          </Text>

          {!stats ? (
            <View style={styles.statsLoadingBlock}>
              <ActivityIndicator size="small" color="#E50914" />
              <Text style={styles.statsLoadingText}>Synchronizing host diagnostics...</Text>
            </View>
          ) : (
            <View style={styles.statsContainer}>
              {/* 🏥 Overall Server Health Summary Section */}
              <View style={[styles.healthSummaryCard, { borderColor: health.color }]}>
                <View style={styles.healthSummaryHeader}>
                  <Text style={styles.healthSummaryLabel}>System Health:</Text>
                  <Text style={[styles.healthSummaryBadge, { color: health.color }]}>
                    ● {health.label}
                  </Text>
                </View>
                <Text style={styles.healthSummaryDesc}>{health.desc}</Text>
              </View>

              {/* CPU Usage Meter */}
              <View style={styles.metricRow}>
                <View style={styles.metricLabelRow}>
                  <Text style={styles.metricTitle}>CPU Utilization</Text>
                  <Text style={styles.metricValue}>{stats.cpuUsage}%</Text>
                </View>
                <View style={styles.meterTrack}>
                  <View 
                    style={[
                      styles.meterFill, 
                      { 
                        width: `${stats.cpuUsage}%`, 
                        backgroundColor: stats.cpuUsage > 80 ? '#E50914' : stats.cpuUsage > 50 ? '#FFC107' : '#4FAF50' 
                      }
                    ]} 
                  />
                </View>
              </View>

              {/* Memory Usage Meter */}
              <View style={styles.metricRow}>
                <View style={styles.metricLabelRow}>
                  <Text style={styles.metricTitle}>RAM Memory</Text>
                  <Text style={styles.metricValue}>
                    {stats.memoryUsed} MB / {stats.memoryTotal} MB
                  </Text>
                </View>
                <View style={styles.meterTrack}>
                  <View 
                    style={[
                      styles.meterFill, 
                      { 
                        width: `${Math.min(100, (stats.memoryUsed / stats.memoryTotal) * 100)}%`, 
                        backgroundColor: (stats.memoryUsed / stats.memoryTotal) > 0.85 ? '#E50914' : (stats.memoryUsed / stats.memoryTotal) > 0.6 ? '#FFC107' : '#4FAF50' 
                      }
                    ]} 
                  />
                </View>
              </View>

              {/* Disk Space Meter */}
              <View style={styles.metricRow}>
                <View style={styles.metricLabelRow}>
                  <Text style={styles.metricTitle}>Storage Disk</Text>
                  <Text style={styles.metricValue}>
                    {stats.diskUsed} GB / {stats.diskTotal} GB
                  </Text>
                </View>
                <View style={styles.meterTrack}>
                  <View 
                    style={[
                      styles.meterFill, 
                      { 
                        width: `${Math.min(100, (stats.diskUsed / stats.diskTotal) * 100)}%`, 
                        backgroundColor: (stats.diskUsed / stats.diskTotal) > 0.9 ? '#E50914' : '#4FAF50' 
                      }
                    ]} 
                  />
                </View>
              </View>

              {/* Hardware Grid metrics */}
              <View style={styles.metricsGrid}>
                {/* CPU Temp */}
                <View style={styles.gridCell}>
                  <Text style={styles.gridCellLabel}>CPU Temp</Text>
                  <Text 
                    style={[
                      styles.gridCellValue, 
                      { color: stats.cpuTemp > 65 ? '#FF5722' : stats.cpuTemp > 50 ? '#FFC107' : '#4FAF50' }
                    ]}
                  >
                    {stats.cpuTemp}°C
                  </Text>
                </View>

                {/* System Load */}
                <View style={styles.gridCell}>
                  <Text style={styles.gridCellLabel}>Load Avg</Text>
                  <Text style={[styles.gridCellValue, { fontSize: 13 }]}>
                    {stats.loadAvg ? stats.loadAvg.join(', ') : 'N/A'}
                  </Text>
                </View>
              </View>

              <View style={styles.metricsGrid}>
                {/* Network IO rx/tx */}
                <View style={styles.gridCell}>
                  <Text style={styles.gridCellLabel}>Network Rx</Text>
                  <Text style={styles.gridCellValue}>{stats.networkRx} MB</Text>
                </View>

                <View style={styles.gridCell}>
                  <Text style={styles.gridCellLabel}>Network Tx</Text>
                  <Text style={styles.gridCellValue}>{stats.networkTx} MB</Text>
                </View>
              </View>

              {/* System Uptime banner */}
              <View style={styles.uptimeBannerBlock}>
                <Text style={styles.uptimeLabel}>System Uptime:</Text>
                <Text style={styles.uptimeValue}>{formatUptime(stats.uptime)}</Text>
              </View>

            </View>
          )}
        </View>
      )}

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
  inputReadOnly: {
    backgroundColor: '#202020',
    borderRadius: 6,
    color: '#FFFF',
    paddingVertical: 14,
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
  },
  statsLoadingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1E1E1E',
    padding: 12,
    borderRadius: 6
  },
  statsLoadingText: {
    color: '#888',
    fontSize: 13
  },
  statsContainer: {
    marginTop: 8
  },
  healthSummaryCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 8,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 16
  },
  healthSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  healthSummaryLabel: {
    color: '#E5E5EA',
    fontSize: 13,
    fontWeight: '700'
  },
  healthSummaryBadge: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  healthSummaryDesc: {
    color: '#AEAEB2',
    fontSize: 12,
    lineHeight: 16
  },
  metricRow: {
    marginBottom: 12
  },
  metricLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  metricTitle: {
    color: '#CCC',
    fontSize: 12,
    fontWeight: '600'
  },
  metricValue: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700'
  },
  meterTrack: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden'
  },
  meterFill: {
    height: '100%',
    borderRadius: 4
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12
  },
  gridCell: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2D2D2D'
  },
  gridCellLabel: {
    color: '#888',
    fontSize: 11,
    marginBottom: 4
  },
  gridCellValue: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700'
  },
  uptimeBannerBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1F2937',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#374151',
    marginTop: 4
  },
  uptimeLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600'
  },
  uptimeValue: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '700'
  }
});
