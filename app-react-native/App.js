/**
 * 📱 PiStream Mobile App - React Native Expo
 * Fulfills all stream-seeking, background audio, auto-reconnection,
 * offline indication, quality and seeder status requirements.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Platform,
  Alert
} from 'react-native';
import { Video, Audio } from 'expo-av';
import { 
  Play, 
  Search, 
  Film, 
  CircleDot, 
  Info, 
  Volume2, 
  ShieldAlert, 
  ArrowLeft, 
  RefreshCw, 
  Settings,
  AlertTriangle,
  ArrowUpCircle
} from 'lucide-react-native';

import { getBackendUrl } from './src/config.js';
import { searchTorrents, testConnection } from './src/services/api.js';
import { checkForAppUpdates, performAppUpgrade, CLIENT_VERSION } from './src/services/updateChecker.js';
import SettingsScreen from './src/screens/SettingsScreen.js';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [activeStreamUrl, setActiveStreamUrl] = useState(null);
  const [playingTorrent, setPlayingTorrent] = useState(null);
  const [playbackStatus, setPlaybackStatus] = useState({});
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  // Settings & Connection
  const [showSettings, setShowSettings] = useState(false);
  const [currentBackendUrl, setCurrentBackendUrl] = useState('');
  const [isServerOnline, setIsServerOnline] = useState(true);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  // Auto-discovery state
  const [isAutoDiscovering, setIsAutoDiscovering] = useState(true);
  const [discoveryLog, setDiscoveryLog] = useState('Connecting to primary static IP...');
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  
  // Versions
  const [updateAvailable, setUpdateAvailable] = useState(null);
  
  const videoRef = useRef(null);

  // Load Settings and Check Connection Status on Start
  const refreshServerState = async (forceDiscover = false) => {
    setIsCheckingConnection(true);
    setDiscoveryLog('Checking primary static IP (192.168.68.102)...');
    
    try {
      let url = forceDiscover ? null : await getBackendUrl();
      let online = false;
      
      if (url) {
        online = await testConnection(url);
      }

      if (online) {
        setCurrentBackendUrl(url);
        setIsServerOnline(true);
        setIsAutoDiscovering(false);
        setDiscoveryFailed(false);
      } else {
        // Automatically start discovery if primary fails or we force it
        setIsAutoDiscovering(true);
        setDiscoveryFailed(false);
        setDiscoveryLog('Static IP unavailable. Searching local network...');
        
        let attempts = 0;
        let discoveredUrl = null;

        while (attempts < 3 && !discoveredUrl) {
          attempts++;
          setDiscoveryLog(`Network Scan Pass ${attempts}/3...`);
          
          try {
            const { autoDiscoverServer } = require('./src/config.js');
            discoveredUrl = await autoDiscoverServer((msg) => setDiscoveryLog(msg));
          } catch(e) {}
          
          if (!discoveredUrl && attempts < 3) {
            setDiscoveryLog(`Retrying scan...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        if (discoveredUrl) {
          const { saveBackendUrl } = require('./src/config.js');
          await saveBackendUrl(discoveredUrl);
          setCurrentBackendUrl(discoveredUrl);
          setIsServerOnline(true);
          setIsAutoDiscovering(false);
          setDiscoveryFailed(false);
        } else {
          setIsServerOnline(false);
          setIsAutoDiscovering(false);
          setDiscoveryFailed(true);
        }
      }
    } catch (e) {
      setIsServerOnline(false);
      setIsAutoDiscovering(false);
      setDiscoveryFailed(true);
    } finally {
      setIsCheckingConnection(false);
    }
  };

  useEffect(() => {
    refreshServerState();
    
    // Background Update Check on Startup
    async function triggerUpdateCheck() {
      try {
        const info = await checkForAppUpdates();
        if (info && info.hasUpdate) {
          setUpdateAvailable(info);
        }
      } catch (e) {}
    }
    triggerUpdateCheck();

    // Repeated update checker runs every 30 minutes
    const updateTimer = setInterval(triggerUpdateCheck, 30 * 60 * 1000);
    return () => clearInterval(updateTimer);
  }, []);

  // Configure Background Audio Playback Session
  useEffect(() => {
    async function configureAudio() {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldRouteThroughEarpieceAndroid: false,
          staysActiveInBackground: true, // Audio resumes in background!
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.warn('Silent audio profile failed to initiate: ', e.message);
      }
    }
    configureAudio();
  }, []);

  const triggerSearch = async (term) => {
    if (!term || term.trim() === '') return;
    setIsSearching(true);
    try {
      const data = await searchTorrents(term, activeCategory === 'all' ? 'all' : activeCategory);
      if (data.success) {
        setSearchResults(data.results);
        setIsServerOnline(true);
      } else {
        setSearchResults([]);
      }
    } catch (e) {
      setIsServerOnline(false);
      Alert.alert(
        'Server Unreachable', 
        'Could not stream to your torrent server. Open settings to check your server connection and IP address.'
      );
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartStream = (torrent) => {
    // Encode magnet link to base64 safely for HTTP parameter passing
    const base64Magnet = btoa(torrent.magnet).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const streamEndpoint = `${currentBackendUrl}/api/stream/${base64Magnet}`;

    setPlayingTorrent(torrent);
    setActiveStreamUrl(streamEndpoint);
  };

  const handleVideoError = async (error) => {
    console.warn('[Player Error] Stream disconnected: ', error);
    
    // Auto-reconnect triggered if stream drops unexpectedly
    if (activeStreamUrl && !isReconnecting) {
      setIsReconnecting(true);
      videoRef.current?.setStatusAsync({ shouldPlay: false });

      let attempts = 0;
      const retryInterval = setInterval(async () => {
        attempts++;
        console.log(`[Player Reconnect] Session reconnect attempt: ${attempts}`);
        
        try {
          const check = await testConnection(`${currentBackendUrl}`);
          if (check) {
            clearInterval(retryInterval);
            videoRef.current?.loadAsync({ uri: activeStreamUrl }, {}, true);
            videoRef.current?.setStatusAsync({ shouldPlay: true });
            setIsReconnecting(false);
          }
        } catch (e) {}

        if (attempts >= 5) {
          clearInterval(retryInterval);
          setIsReconnecting(false);
          Alert.alert('Stream Disconnected', 'Connection timed out. Reselect the stream or search again.');
          setActiveStreamUrl(null);
          setPlayingTorrent(null);
        }
      }, 5000);
    }
  };

  const categories = [
    { label: 'All Media', id: 'all' },
    { label: 'Movies', id: 'movie' },
    { label: 'TV Shows', id: 'series' },
    { label: 'Anime', id: 'anime' }
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* 🚀 STARTUP DISCOVERY UI OVERLAYS */}
      {isAutoDiscovering && (
        <View style={styles.fullScreenOverlay}>
          <ActivityIndicator size="large" color="#E50914" />
          <Text style={styles.overlayTitle}>Searching for PiStream Server...</Text>
          <Text style={styles.overlayLog}>{discoveryLog}</Text>
        </View>
      )}

      {!isAutoDiscovering && discoveryFailed && !showSettings && (
        <View style={styles.fullScreenOverlay}>
          <AlertTriangle color="#E50914" size={64} style={{ marginBottom: 20 }} />
          <Text style={styles.overlayTitle}>Server Not Found</Text>
          <Text style={styles.overlayLog}>
            Could not locate your PiStream server on '192.168.68.102' or any local subnet.
          </Text>
          <TouchableOpacity 
            style={styles.retryOverlayBtn}
            onPress={() => refreshServerState(true)}
          >
            <Text style={styles.retryOverlayBtnText}>Retry Network Scan</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.retryOverlayBtn, { backgroundColor: '#333', marginTop: 10, borderColor: '#444' }]}
            onPress={() => setShowSettings(true)}
          >
            <Text style={styles.retryOverlayBtnText}>Open Diagnostic Settings</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* ⚙️ SETTINGS VIEW POPUP */}
      {showSettings ? (
        <SettingsScreen 
          onClose={() => {
            setShowSettings(false);
          }} 
        />
      ) : activeStreamUrl && !isAutoDiscovering && !discoveryFailed ? (
        /* 🎬 FULL SCREEN PLAYER GATE */
        <View style={styles.fullscreenPlayerContainer}>
          <Video
            ref={videoRef}
            source={{ uri: activeStreamUrl }}
            rate={1.0}
            volume={1.0}
            isMuted={false}
            resizeMode={Video.RESIZE_MODE_CONTAIN}
            shouldPlay
            useNativeControls
            onPlaybackStatusUpdate={(status) => setPlaybackStatus(() => status)}
            onError={handleVideoError}
            style={styles.fullscreenVideo}
          />

          {/* Core Player HUD Overlay */}
          <View style={styles.playerHeaderOverlay}>
            <TouchableOpacity 
              style={styles.backButton} 
              onPress={() => {
                videoRef.current?.unloadAsync();
                setActiveStreamUrl(null);
                setPlayingTorrent(null);
              }}
            >
              <ArrowLeft color="#FFFFFF" size={24} />
              <Text style={styles.backButtonText}>Exit Playback</Text>
            </TouchableOpacity>
          </View>

          {/* Buffering and Connection Feedback */}
          {playbackStatus.isBuffering && (
            <View style={styles.bufferingOverlay}>
              <ActivityIndicator size="large" color="#E50914" />
              <Text style={styles.bufferingText}>
                {isReconnecting 
                  ? 'Reconnecting dropped stream...' 
                  : 'Buffering torrent pieces sequentially...'}
              </Text>
            </View>
          )}

          {/* Buffering percentage indicator bar */}
          <View style={styles.bufferProgressIndicator}>
            <View style={styles.bufferingBarTrack}>
              <View 
                style={[
                  styles.bufferingBarFill, 
                  { 
                    width: `${playbackStatus.playableDurationMillis && playbackStatus.durationMillis 
                      ? (playbackStatus.playableDurationMillis / playbackStatus.durationMillis) * 100 
                      : 0}%` 
                  }
                ]} 
              />
            </View>
            <Text style={styles.offlineBufferText}>
              Offline Buffered: {playbackStatus.playableDurationMillis 
                ? `${Math.floor(playbackStatus.playableDurationMillis / 1000 / 60)}m / ${Math.floor(playbackStatus.durationMillis / 1000 / 60)}m` 
                : 'Connecting peers...'}
            </Text>
          </View>
        </View>
      ) : !isAutoDiscovering && !discoveryFailed ? (
        /* 🔍 MAIN SEARCH PAGE */
        <View style={{ flex: 1 }}>
          
          {/* Brand Row with Gear Button */}
          <View style={styles.brandRow}>
            <TouchableOpacity 
              style={styles.settingsToggleButton}
              onPress={() => setShowSettings(true)}
            >
              <Settings color="#FFFFFF" size={20} />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.brandTextPrefix}>PI</Text>
              <Text style={styles.brandTextSuffix}>STREAM</Text>
              <Text style={styles.badgeBeta}>TORRENT</Text>
            </View>

            <TouchableOpacity 
              style={styles.reloadButton}
              onPress={refreshServerState}
              disabled={isCheckingConnection}
            >
              {isCheckingConnection ? (
                <ActivityIndicator size="small" color="#E50914" />
              ) : (
                <RefreshCw color={isServerOnline ? '#4FAF50' : '#E50914'} size={18} />
              )}
            </TouchableOpacity>
          </View>

          {/* 🔴 OFFLINE WARNING BANNER */}
          {!isServerOnline && (
            <TouchableOpacity 
              style={styles.warningBanner} 
              onPress={() => setShowSettings(true)}
            >
              <AlertTriangle color="#FFFFFF" size={16} />
              <Text style={styles.warningBannerText}>
                Pi Server Offline ({currentBackendUrl}). Tap to Configure IP.
              </Text>
            </TouchableOpacity>
          )}

          {/* 🚀 UPDATE NOTIFICATION BANNER */}
          {updateAvailable && (
            <TouchableOpacity 
              style={styles.updateBanner} 
              onPress={() => performAppUpgrade(updateAvailable)}
            >
              <ArrowUpCircle color="#FFFFFF" size={16} />
              <Text style={styles.updateBannerText}>
                New version available: v{updateAvailable.latestVersion}. Tap to upgrade!
              </Text>
            </TouchableOpacity>
          )}

          {/* Elegant Search Enclosure */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search Movie, TV show, or Anime torrents..."
              placeholderTextColor="#757575"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => triggerSearch(searchQuery)}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchIconButton} onPress={() => triggerSearch(searchQuery)}>
              <Search color="#FFFFFF" size={20} />
            </TouchableOpacity>
          </View>

          {/* Categories Pill Scroller */}
          <View style={styles.categoriesContainer}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryPill,
                  activeCategory === cat.id && styles.categoryPillActive
                ]}
                onPress={() => {
                  setActiveCategory(cat.id);
                  if (searchQuery) triggerSearch(searchQuery);
                }}
              >
                <Text 
                  style={[
                    styles.categoryText,
                    activeCategory === cat.id && styles.categoryTextActive
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Results Scroller Content */}
          {isSearching ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#E50914" />
              <Text style={styles.loadingLabel}>Searching multiple scrapers in parallel...</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => index.toString()}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Film color="#757575" size={48} />
                  <Text style={styles.emptyHeading}>Live Stream Torrent Search</Text>
                  
                  {!isServerOnline ? (
                    <View style={styles.offlineGuide}>
                      <Text style={styles.offlineGuideText}>
                        Your PiStream server at {currentBackendUrl} appears to be offline. Please connect to the same Wi-Fi network and launch settings to auto-discover your Pi.
                      </Text>
                      <TouchableOpacity 
                        style={styles.offlineActionBtn}
                        onPress={() => setShowSettings(true)}
                      >
                        <Text style={styles.offlineActionBtnText}>⚙️ Setup Connection IP</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.emptySubtitle}>
                      Enter your desired video query. Magnet links are resolved and loaded directly into sequence on the VPS/Pi servers for instant previews.
                    </Text>
                  )}
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.resultCard} 
                  onPress={() => handleStartStream(item)}
                  activeOpacity={0.8}
                >
                  <View style={styles.resultDetailsHeader}>
                    <Text style={styles.resultTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <View style={styles.badgeRow}>
                      <View style={[styles.badge, styles.badgeQuality]}>
                        <Text style={styles.badgeText}>{item.quality}</Text>
                      </View>
                      <View style={[styles.badge, styles.badgeSource]}>
                        <Text style={styles.badgeText}>{item.source}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.resultSizingFooter}>
                    <View style={styles.footerDataGroup}>
                      <CircleDot color="#4CAF50" size={14} />
                      <Text style={styles.footerDataLabel}>Seeds: </Text>
                      <Text style={styles.footerDataValue}>{item.seeders}</Text>
                    </View>
                    
                    <View style={styles.footerDataGroup}>
                      <CircleDot color="#FFC107" size={14} />
                      <Text style={styles.footerDataLabel}>Peers: </Text>
                      <Text style={styles.footerDataValue}>{item.leechers}</Text>
                    </View>

                    <View style={styles.footerDataGroup}>
                      <Text style={styles.footerDataLabel}>Size: </Text>
                      <Text style={styles.footerDataValueBold}>{item.size}</Text>
                    </View>
                  </View>

                  <View style={styles.startStreamAnchor}>
                    <Play color="#FFFFFF" size={16} fill="#FFFFFF" />
                    <Text style={styles.streamTextIndicator}>Instantly Stream Now</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A'
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginVertical: 18
  },
  brandTextPrefix: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2
  },
  brandTextSuffix: {
    color: '#E50914',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2
  },
  badgeBeta: {
    marginLeft: 10,
    fontSize: 10,
    fontWeight: '700',
    color: '#49DF49',
    backgroundColor: 'rgba(73, 223, 73, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  settingsToggleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333'
  },
  reloadButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333'
  },
  warningBanner: {
    backgroundColor: '#E50914',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10
  },
  warningBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center'
  },
  updateBanner: {
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10
  },
  updateBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center'
  },
  searchContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333'
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    height: 50,
    paddingHorizontal: 16,
    fontSize: 15
  },
  searchIconButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E50914',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8
  },
  categoriesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 16,
    paddingHorizontal: 10
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#2D2D2D'
  },
  categoryPillActive: {
    backgroundColor: '#E50914',
    borderColor: '#E50914'
  },
  categoryText: {
    color: '#B3B3B3',
    fontWeight: '600',
    fontSize: 13
  },
  categoryTextActive: {
    color: '#FFFFFF'
  },
  listContent: {
    paddingBottom: 24
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80
  },
  loadingLabel: {
    color: '#B3B3B3',
    marginTop: 14,
    fontSize: 14,
    fontWeight: '500'
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    marginTop: 60
  },
  emptyHeading: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8
  },
  emptySubtitle: {
    color: '#B3B3B3',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20
  },
  offlineGuide: {
    alignItems: 'center',
    marginTop: 10
  },
  offlineGuideText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16
  },
  offlineActionBtn: {
    backgroundColor: '#2D2D2D',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#444'
  },
  offlineActionBtnText: {
    color: '#FFFF',
    fontWeight: '700',
    fontSize: 13
  },
  resultCard: {
    backgroundColor: '#161616',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262626'
  },
  resultDetailsHeader: {
    marginBottom: 8
  },
  resultTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 8
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4
  },
  badgeQuality: {
    backgroundColor: '#0D47A1'
  },
  badgeSource: {
    backgroundColor: '#3E2723'
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700'
  },
  resultSizingFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#262626'
  },
  footerDataGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  footerDataLabel: {
    color: '#757575',
    fontSize: 12
  },
  footerDataValue: {
    color: '#E0E0E0',
    fontSize: 12,
    fontWeight: '600'
  },
  footerDataValueBold: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700'
  },
  startStreamAnchor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    backgroundColor: '#1E1E1E',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6
  },
  streamTextIndicator: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  },
  fullscreenPlayerContainer: {
    backgroundColor: '#000',
    flex: 1
  },
  fullscreenVideo: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    flex: 1
  },
  playerHeaderOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 16,
    zIndex: 10
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5
  },
  bufferingText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40
  },
  bufferProgressIndicator: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 60 : 30,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center'
  },
  bufferingBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6
  },
  bufferingBarFill: {
    height: '100%',
    backgroundColor: '#4FAF50'
  },
  offlineBufferText: {
    color: '#999',
    fontSize: 11,
    fontWeight: '500'
  },
  fullScreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    paddingHorizontal: 40
  },
  overlayTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center'
  },
  overlayLog: {
    color: '#B3B3B3',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30
  },
  retryOverlayBtn: {
    backgroundColor: '#E50914',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center'
  },
  retryOverlayBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700'
  }
});
