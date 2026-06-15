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
import { Play, Search, Film, CircleDot, Info, Volume2, ShieldAlert, ArrowLeft, RefreshCw } from 'lucide-react-native';

const BACKEND_URL = 'http://YOUR_VPS_IP:3000'; // Default server connection

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [activeStreamUrl, setActiveStreamUrl] = useState(null);
  const [playingTorrent, setPlayingTorrent] = useState(null);
  const [playbackStatus, setPlaybackStatus] = useState({});
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  const videoRef = useRef(null);

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
      const response = await fetch(`${BACKEND_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: term,
          type: activeCategory === 'all' ? 'all' : activeCategory
        })
      });
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.results);
      } else {
        setSearchResults([]);
      }
    } catch (e) {
      Alert.alert(
        'Connection Failed', 
        'Could not stream to your torrent server. Ensure your backend URL is set correctly in App.js.'
      );
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartStream = (torrent) => {
    // Encode magnet link to base64 safely for HTTP parameter passing
    const base64Magnet = btoa(torrent.magnet).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const streamEndpoint = `${BACKEND_URL}/api/stream/${base64Magnet}`;

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
          const check = await fetch(`${BACKEND_URL}/api/status`);
          if (check.ok) {
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
      
      {/* 🎬 FULL SCREEN PLAYER GATE */}
      {activeStreamUrl ? (
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
      ) : (
        /* 🔍 MAIN SEARCH PAGE */
        <View style={{ flex: 1 }}>
          
          {/* Brand Row */}
          <View style={styles.brandRow}>
            <Text style={styles.brandTextPrefix}>PI</Text>
            <Text style={styles.brandTextSuffix}>STREAM</Text>
            <Text style={styles.badgeBeta}>TORRENT</Text>
          </View>

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
                  <Text style={styles.emptySubtitle}>
                    Enter your desired video query. Magnet links are resolved and loaded directly into sequence on the VPS servers for instant previews.
                  </Text>
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
      )}
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
    justifyContent: 'center',
    marginVertical: 18
  },
  brandTextPrefix: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2
  },
  brandTextSuffix: {
    color: '#E50914',
    fontSize: 24,
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
  }
});
