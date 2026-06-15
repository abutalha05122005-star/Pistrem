package com.example.ui.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.local.AppDatabase
import com.example.data.model.Movie
import com.example.data.model.PiDeviceStatus
import com.example.data.model.UserProfile
import com.example.data.repository.MovieRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class ConnectionMode {
    LOCAL_DEMO,     // Fully functional mock streams for immediate in-emulator play testing
    LAN,            // Raspberry Pi Local network connection
    REMOTE_TUNNEL   // Secure Cloudflare / Tailscale dynamic internet connection
}

class PiStreamViewModel(application: Application) : AndroidViewModel(application) {

    private val database = AppDatabase.getDatabase(application)
    private val repository = MovieRepository(database.movieDao, database.userProfileDao)

    // Connection configuration
    private val _serverIp = MutableStateFlow("192.168.1.100")
    val serverIp: StateFlow<String> = _serverIp.asStateFlow()

    private val _serverPort = MutableStateFlow("3000")
    val serverPort: StateFlow<String> = _serverPort.asStateFlow()

    private val _serverTunnel = MutableStateFlow("https://pistream.locallink.dev")
    val serverTunnel: StateFlow<String> = _serverTunnel.asStateFlow()

    private val _connectionMode = MutableStateFlow(ConnectionMode.LOCAL_DEMO)
    val connectionMode: StateFlow<ConnectionMode> = _connectionMode.asStateFlow()

    private val _isConnected = MutableStateFlow(true) // True for Local_Demo by default
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _deviceStatus = MutableStateFlow<PiDeviceStatus?>(null)
    val deviceStatus: StateFlow<PiDeviceStatus?> = _deviceStatus.asStateFlow()

    // Auth flows
    private val _isLoggedIn = MutableStateFlow(false)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    private val _authToken = MutableStateFlow("")
    val authToken: StateFlow<String> = _authToken.asStateFlow()

    private val _userEmail = MutableStateFlow("")
    val userEmail: StateFlow<String> = _userEmail.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    private val _isAuthLoading = MutableStateFlow(false)
    val isAuthLoading: StateFlow<Boolean> = _isAuthLoading.asStateFlow()

    // Profile Management flows
    private val _profiles = MutableStateFlow<List<UserProfile>>(emptyList())
    val profiles: StateFlow<List<UserProfile>> = _profiles.asStateFlow()

    private val _activeProfile = MutableStateFlow<UserProfile?>(null)
    val activeProfile: StateFlow<UserProfile?> = _activeProfile.asStateFlow()

    // Library Cache flows
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _syncMessage = MutableStateFlow<String?>(null)
    val syncMessage: StateFlow<String?> = _syncMessage.asStateFlow()

    // Playback navigation
    private val _selectedMovie = MutableStateFlow<Movie?>(null)
    val selectedMovie: StateFlow<Movie?> = _selectedMovie.asStateFlow()

    private val _activePlayingMovie = MutableStateFlow<Movie?>(null)
    val activePlayingMovie: StateFlow<Movie?> = _activePlayingMovie.asStateFlow()

    // Exposed lists combined reactive filters
    private val _movies = MutableStateFlow<List<Movie>>(emptyList())
    val movies: StateFlow<List<Movie>> = _movies.asStateFlow()

    private val _continueWatching = MutableStateFlow<List<Movie>>(emptyList())
    val continueWatching: StateFlow<List<Movie>> = _continueWatching.asStateFlow()

    private val _favorites = MutableStateFlow<List<Movie>>(emptyList())
    val favorites: StateFlow<List<Movie>> = _favorites.asStateFlow()

    private var movieObservationJob: kotlinx.coroutines.Job? = null

    // Filter list for live searches
    val filteredMovies: StateFlow<List<Movie>> = movies
        .combine(searchQuery) { movieSelection, query ->
            if (query.isBlank()) {
                movieSelection
            } else {
                movieSelection.filter {
                    it.title.contains(query, ignoreCase = true) ||
                    it.description.contains(query, ignoreCase = true)
                }
            }
        }.stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    init {
        // Automatically preseed mock movies for instant out-of-the-box streaming demonstration
        viewModelScope.launch {
            repository.seedMockMovies()
            loadUserProfileList()
        }
    }

    // Dynamic reactive profiles selector action
    fun selectProfile(profile: UserProfile?) {
        _activeProfile.value = profile
        
        movieObservationJob?.cancel()
        if (profile != null) {
            movieObservationJob = viewModelScope.launch {
                // Observe movie changes for this profile
                launch {
                    repository.getAllMoviesForProfile(profile.id).collect {
                        // Apply personalization recommendations here before emitting!
                        _movies.value = applyPersonalizedRecommendations(it, profile)
                    }
                }
                launch {
                    repository.getContinueWatchingForProfile(profile.id).collect {
                        _continueWatching.value = it
                    }
                }
                launch {
                    repository.getFavoritesForProfile(profile.id).collect {
                        _favorites.value = it
                    }
                }
            }
        } else {
            // fallback to default un-profiled flow (seed values)
            movieObservationJob = viewModelScope.launch {
                launch {
                    repository.allMovies.collect {
                        _movies.value = it
                    }
                }
                launch {
                    repository.continueWatching.collect {
                        _continueWatching.value = it
                    }
                }
                launch {
                    repository.favorites.collect {
                        _favorites.value = it
                    }
                }
            }
        }
    }

    private fun applyPersonalizedRecommendations(moviesList: List<Movie>, profile: UserProfile): List<Movie> {
        // If it's a kids profile, restrict content to PG/G, and hide any R or PG-13 content
        val ageFiltered = if (profile.isKids) {
            moviesList.filter { it.rating.uppercase() in listOf("G", "PG", "TV-G", "TV-Y", "TV-Y7") }
        } else {
            moviesList
        }

        // Reorder list based on favorite genre
        return ageFiltered.sortedWith(compareByDescending { movie ->
            val matchesGenre = when (profile.favoriteGenre.uppercase()) {
                "SCI-FI" -> movie.description.contains("universe", ignoreCase = true) || movie.description.contains("cosmic", ignoreCase = true)
                "ACTION" -> movie.title.contains("Sintel", ignoreCase = true) || movie.description.contains("brave", ignoreCase = true)
                "DOCUMENTARIES" -> movie.description.contains("documentary", ignoreCase = true) || movie.description.contains("oceanic", ignoreCase = true) || movie.description.contains("witness", ignoreCase = true)
                "NATURE" -> movie.description.contains("abyssal", ignoreCase = true) || movie.description.contains("marine", ignoreCase = true)
                "KIDS" -> movie.rating.uppercase() == "G" || movie.rating.uppercase() == "PG"
                else -> false
            }
            if (matchesGenre) 1 else 0
        })
    }

    fun createOrUpdateProfile(name: String, avatarUrl: String, isKids: Boolean, favoriteGenre: String) {
        val email = _userEmail.value.ifBlank { "streamer@raspi.lan" }
        viewModelScope.launch {
            val profileId = "${email}_${name.lowercase().replace(" ", "_")}"
            val profile = UserProfile(
                id = profileId,
                userEmail = email,
                name = name,
                avatarUrl = avatarUrl,
                isKids = isKids,
                favoriteGenre = favoriteGenre
            )
            
            // 1. Save local
            repository.insertLocalProfile(profile)
            
            // 2. Save server if online
            if (_isLoggedIn.value && _connectionMode.value != ConnectionMode.LOCAL_DEMO) {
                try {
                    repository.saveProfileToServer(getResolvedBaseUrl(), _authToken.value, profile)
                } catch (e: Exception) {
                    Log.e("PiStreamVM", "Failed to sync profile creation with server: ${e.message}")
                }
            }
            
            // Refresh list
            loadUserProfileList()
        }
    }

    fun deleteProfile(profileId: String) {
        viewModelScope.launch {
            // If deleting the active profile, reset active profile
            if (_activeProfile.value?.id == profileId) {
                selectProfile(null)
            }
            
            // 1. Delete local
            repository.deleteLocalProfile(profileId)
            
            // 2. Delete server
            if (_isLoggedIn.value && _connectionMode.value != ConnectionMode.LOCAL_DEMO) {
                try {
                    repository.deleteProfileFromServer(getResolvedBaseUrl(), _authToken.value, profileId)
                } catch (e: Exception) {
                    Log.e("PiStreamVM", "Failed to delete profile on server: ${e.message}")
                }
            }
            
            // Refresh list
            loadUserProfileList()
        }
    }

    fun loadUserProfileList() {
        val email = _userEmail.value.ifBlank { "streamer@raspi.lan" }
        viewModelScope.launch {
            // First load local profiles
            repository.getLocalProfiles(email).collect { localList ->
                // If local list is empty, seed a default profile so user starts with at least one
                if (localList.isEmpty()) {
                    val defaultProfile = UserProfile(
                        id = "${email}_default",
                        userEmail = email,
                        name = "Viewer One",
                        avatarUrl = "avatar_red",
                        isKids = false,
                        favoriteGenre = "Sci-Fi"
                    )
                    repository.insertLocalProfile(defaultProfile)
                    _profiles.value = listOf(defaultProfile)
                    selectProfile(defaultProfile)
                } else {
                    _profiles.value = localList
                    if (_activeProfile.value == null) {
                        selectProfile(localList.first())
                    } else {
                        selectProfile(localList.find { it.id == _activeProfile.value?.id } ?: localList.first())
                    }
                }
            }
        }
    }

    fun syncProfilesFromServer() {
        if (!_isLoggedIn.value || _connectionMode.value == ConnectionMode.LOCAL_DEMO) return
        viewModelScope.launch {
            try {
                val remoteProfiles = repository.fetchProfilesFromServer(getResolvedBaseUrl(), _authToken.value)
                for (p in remoteProfiles) {
                    repository.insertLocalProfile(p)
                }
                loadUserProfileList()
            } catch (e: Exception) {
                Log.e("PiStreamVM", "Profiles remote sync failed: ${e.message}")
            }
        }
    }

    // URL resolution helper
    fun getResolvedBaseUrl(): String {
        return when (_connectionMode.value) {
            ConnectionMode.LOCAL_DEMO -> "http://127.0.0.1:3000" // Simulated
            ConnectionMode.LAN -> "http://${_serverIp.value}:${_serverPort.value}"
            ConnectionMode.REMOTE_TUNNEL -> _serverTunnel.value
        }
    }

    fun setConnectionConfig(mode: ConnectionMode, ip: String, port: String, tunnel: String) {
        _connectionMode.value = mode
        _serverIp.value = ip
        _serverPort.value = port
        _serverTunnel.value = tunnel

        viewModelScope.launch {
            if (mode == ConnectionMode.LOCAL_DEMO) {
                _isConnected.value = true
                _deviceStatus.value = PiDeviceStatus(
                    serverName = "PiStream Demo Hub",
                    version = "v1.2.0-MVP",
                    ffmpegAvailable = true,
                    diskFreeSpace = "196.4 GB / 256.0 GB",
                    localAddress = "localhost:3000",
                    isRemoteSecure = true
                )
                repository.seedMockMovies()
                loadUserProfileList()
            } else {
                testAndSyncServer()
            }
        }
    }

    fun testAndSyncServer() {
        viewModelScope.launch {
            _isSyncing.value = true
            _syncMessage.value = "Pinging Pi server..."
            _isConnected.value = false
            try {
                val url = getResolvedBaseUrl()
                val status = repository.fetchDeviceStatus(url)
                _deviceStatus.value = status
                _isConnected.value = true
                _syncMessage.value = "Pi Stream Server online! Fetching records..."

                if (_isLoggedIn.value) {
                    syncMoviesFromServer()
                    syncProfilesFromServer()
                } else {
                    _syncMessage.value = "Connected. Login requested to load Library."
                }
            } catch (e: Exception) {
                Log.e("PiStreamVM", "Ping failed: ${e.message}")
                _isConnected.value = false
                _deviceStatus.value = null
                _syncMessage.value = "Pi Server unreachable. Check IP address or Tunnel connection."
            } finally {
                _isSyncing.value = false
            }
        }
    }

    fun syncMoviesFromServer() {
        if (!_isConnected.value || _connectionMode.value == ConnectionMode.LOCAL_DEMO) return
        viewModelScope.launch {
            _isSyncing.value = true
            _syncMessage.value = "Syncing media entries..."
            try {
                val url = getResolvedBaseUrl()
                val count = repository.syncMediaLibrary(url, _authToken.value)
                _syncMessage.value = "Successfully synchronized $count items from Pi."
            } catch (e: Exception) {
                Log.e("PiStreamVM", "Sync failed: ${e.message}")
                _syncMessage.value = "Media listing synchronized locally."
            } finally {
                _isSyncing.value = false
            }
        }
    }

    // Account credentials authentication
    fun submitLogin(email: String, password: String) {
        viewModelScope.launch {
            _isAuthLoading.value = true
            _authError.value = null
            
            if (_connectionMode.value == ConnectionMode.LOCAL_DEMO) {
                // Instantly grant login for simulated demonstration
                _isLoggedIn.value = true
                _authToken.value = "demo-jwt-secret-session"
                _userEmail.value = email.ifBlank { "streamer@raspi.lan" }
                _isAuthLoading.value = false
                loadUserProfileList()
                return@launch
            }

            try {
                val url = getResolvedBaseUrl()
                val resp = repository.login(url, mapOf("email" to email, "password" to password))
                _authToken.value = resp.token
                _userEmail.value = resp.userEmail
                _isLoggedIn.value = true
                _authError.value = null
                _syncMessage.value = "Logged in successfully."
                syncMoviesFromServer()
                syncProfilesFromServer()
                loadUserProfileList()
            } catch (e: Exception) {
                _authError.value = "Auth failed: ${e.localizedMessage ?: "Invalid login details"}"
            } finally {
                _isAuthLoading.value = false
            }
        }
    }

    fun submitRegister(email: String, password: String) {
        viewModelScope.launch {
            _isAuthLoading.value = true
            _authError.value = null

            if (_connectionMode.value == ConnectionMode.LOCAL_DEMO) {
                _isLoggedIn.value = true
                _authToken.value = "demo-jwt-secret-session"
                _userEmail.value = email
                _isAuthLoading.value = false
                loadUserProfileList()
                return@launch
            }

            try {
                val url = getResolvedBaseUrl()
                val resp = repository.register(url, mapOf("email" to email, "password" to password))
                _authToken.value = resp.token
                _userEmail.value = resp.userEmail
                _isLoggedIn.value = true
                _authError.value = null
                _syncMessage.value = "Account registered successfully."
                syncMoviesFromServer()
                syncProfilesFromServer()
                loadUserProfileList()
            } catch (e: Exception) {
                _authError.value = "Account creation failed: ${e.localizedMessage ?: "Please try again."}"
            } finally {
                _isAuthLoading.value = false
            }
        }
    }

    fun submitLogout() {
        _isLoggedIn.value = false
        _authToken.value = ""
        _userEmail.value = ""
        _authError.value = null
        _syncMessage.value = "Logged out successfully."
        
        _activeProfile.value = null
        _profiles.value = emptyList()

        // Return dummy listing when logging out of physical servers
        if (_connectionMode.value != ConnectionMode.LOCAL_DEMO) {
            viewModelScope.launch {
                repository.clearCache()
                repository.seedMockMovies()
                loadUserProfileList()
            }
        }
    }

    // Media and search actions
    fun selectMovie(movie: Movie?) {
        _selectedMovie.value = movie
    }

    fun launchPlayer(movie: Movie?) {
        _activePlayingMovie.value = movie
    }

    fun updateSearchQuery(query: String) {
        _searchQuery.value = query
    }

    fun toggleFavoriteMovie(movieId: String, currentStatus: Boolean) {
        viewModelScope.launch {
            val profile = _activeProfile.value
            if (profile != null) {
                repository.toggleProfileFavorite(profile.id, movieId, !currentStatus)
            } else {
                repository.toggleFavorite(movieId, !currentStatus)
            }
        }
    }

    // Playback Sync reporting back to physical server if connected
    fun trackPlaybackProgress(id: String, progress: Float, progressSeconds: Long, totalSeconds: Long) {
        viewModelScope.launch {
            val profile = _activeProfile.value
            if (profile != null) {
                repository.updateProfilePlayback(profile.id, id, progress, progressSeconds, totalSeconds)
            } else {
                repository.updateLocalPlayback(id, progress, progressSeconds, totalSeconds)
            }

            // Submit sync payload to actual server if connected in LAN/Tunnel
            if (_isLoggedIn.value && _connectionMode.value != ConnectionMode.LOCAL_DEMO) {
                try {
                    val url = getResolvedBaseUrl()
                    repository.syncPlayback(
                        baseUrl = url,
                        token = _authToken.value,
                        syncData = mapOf(
                            "media_id" to id,
                            "profile_id" to (profile?.id ?: ""),
                            "progress" to progress.toString(),
                            "progressSeconds" to progressSeconds.toString(),
                            "durationSeconds" to totalSeconds.toString()
                        )
                    )
                } catch (e: Exception) {
                    Log.e("PiStreamVM", "Failed sending playback sync back to server: ${e.message}")
                }
            }
        }
    }
}
