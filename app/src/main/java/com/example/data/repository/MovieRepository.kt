package com.example.data.repository

import android.util.Log
import com.example.data.local.MovieDao
import com.example.data.model.AuthResponse
import com.example.data.model.Movie
import com.example.data.model.PiDeviceStatus
import com.example.data.network.PiStreamApi
import com.example.data.local.UserProfileDao
import com.example.data.model.UserProfile
import com.example.data.model.ProfileMovieState
import kotlinx.coroutines.flow.Flow
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

class MovieRepository(
    private val movieDao: MovieDao,
    private val userProfileDao: UserProfileDao
) {

    // Cache streams
    val allMovies: Flow<List<Movie>> = movieDao.getAllMovies()
    val continueWatching: Flow<List<Movie>> = movieDao.getContinueWatchingMovies()
    val favorites: Flow<List<Movie>> = movieDao.getFavoriteMovies()

    // Profile-specific dynamic mappings
    fun getAllMoviesForProfile(profileId: String): Flow<List<Movie>> = movieDao.getAllMoviesForProfile(profileId)
    fun getContinueWatchingForProfile(profileId: String): Flow<List<Movie>> = movieDao.getContinueWatchingMoviesForProfile(profileId)
    fun getFavoritesForProfile(profileId: String): Flow<List<Movie>> = movieDao.getFavoriteMoviesForProfile(profileId)

    // Profiles local CRUD operations
    fun getLocalProfiles(email: String): Flow<List<UserProfile>> = userProfileDao.getProfilesForUser(email)
    suspend fun insertLocalProfile(profile: UserProfile) = userProfileDao.insertProfile(profile)
    suspend fun deleteLocalProfile(profileId: String) = userProfileDao.deleteProfile(profileId)

    // Profile specific movie state tracking
    suspend fun updateProfilePlayback(profileId: String, movieId: String, progress: Float, progressSeconds: Long, durationSeconds: Long) {
        val timestamp = System.currentTimeMillis()
        val existing = userProfileDao.getProfileMovieState(profileId, movieId)
        if (existing == null) {
            userProfileDao.insertProfileMovieState(
                ProfileMovieState(
                    profileId = profileId,
                    movieId = movieId,
                    progress = progress,
                    progressSeconds = progressSeconds,
                    durationSeconds = durationSeconds,
                    lastWatchedTime = timestamp,
                    isFavorite = false
                )
            )
        } else {
            userProfileDao.updateProfilePlaybackProgress(profileId, movieId, progress, progressSeconds, durationSeconds, timestamp)
        }
    }

    suspend fun toggleProfileFavorite(profileId: String, movieId: String, isFavorite: Boolean) {
        val existing = userProfileDao.getProfileMovieState(profileId, movieId)
        if (existing == null) {
            userProfileDao.insertProfileMovieState(
                ProfileMovieState(
                    profileId = profileId,
                    movieId = movieId,
                    progress = 0f,
                    progressSeconds = 0L,
                    durationSeconds = 0L,
                    lastWatchedTime = 0L,
                    isFavorite = isFavorite
                )
            )
        } else {
            userProfileDao.updateProfileFavoriteStatus(profileId, movieId, isFavorite)
        }
    }

    // Profiles networking routines
    suspend fun fetchProfilesFromServer(baseUrl: String, token: String): List<UserProfile> {
        return getApi(baseUrl).getProfilesList("Bearer $token")
    }

    suspend fun saveProfileToServer(baseUrl: String, token: String, profile: UserProfile): UserProfile {
        return getApi(baseUrl).saveProfile("Bearer $token", profile)
    }

    suspend fun deleteProfileFromServer(baseUrl: String, token: String, profileId: String) {
        getApi(baseUrl).deleteProfile("Bearer $token", profileId)
    }

    suspend fun syncPlayback(baseUrl: String, token: String, syncData: Map<String, String>): Map<String, String> {
        return getApi(baseUrl).syncPlayback("Bearer $token", syncData)
    }

    private var activeApi: PiStreamApi? = null
    private var activeUrl: String = ""

    // Dynamic Retrofit Builder
    private fun getApi(baseUrl: String): PiStreamApi {
        val sanitizedUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        if (activeApi != null && activeUrl == sanitizedUrl) {
            return activeApi!!
        }
        
        val client = OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .writeTimeout(3, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(sanitizedUrl)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create())
            .build()

        val api = retrofit.create(PiStreamApi::class.java)
        activeApi = api
        activeUrl = sanitizedUrl
        return api
    }

    fun getMovieById(id: String): Flow<Movie?> = movieDao.getMovieById(id)

    suspend fun getMovieByIdSuspend(id: String): Movie? = movieDao.getMovieByIdSuspend(id)

    suspend fun updateLocalPlayback(id: String, progress: Float, progressSeconds: Long, durationSeconds: Long) {
        val timestamp = System.currentTimeMillis()
        movieDao.updatePlaybackProgress(id, progress, progressSeconds, durationSeconds, timestamp)
    }

    suspend fun toggleFavorite(id: String, isFavorite: Boolean) {
        movieDao.updateFavoriteStatus(id, isFavorite)
    }

    // Ping server and return hardware status details
    suspend fun fetchDeviceStatus(baseUrl: String): PiDeviceStatus {
        return getApi(baseUrl).getDeviceStatus()
    }

    suspend fun login(baseUrl: String, body: Map<String, String>): AuthResponse {
        return getApi(baseUrl).login(body)
    }

    suspend fun register(baseUrl: String, body: Map<String, String>): AuthResponse {
        return getApi(baseUrl).register(body)
    }

    // Cache the media assets locally
    suspend fun syncMediaLibrary(baseUrl: String, token: String): Int {
        val list = getApi(baseUrl).getMediaList("Bearer $token")
        if (list.isNotEmpty()) {
            movieDao.insertMovies(list)
        }
        return list.size
    }

    // Seed dummy mock movies for offline mockup demo
    suspend fun seedMockMovies() {
        val mockData = listOf(
            Movie(
                id = "1",
                title = "Cosmic Odyssey",
                description = "An immersive journey to the edge of the observable universe inside a real-time high fidelity projection dome.",
                category = "trending",
                videoUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", // Real working public HLS (Mux Test)
                thumbnailUrl = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=60",
                duration = "1h 42m",
                year = 2025,
                rating = "PG-13",
                score = "9.8"
            ),
            Movie(
                id = "2",
                title = "Sintel Chronicles",
                description = "A brave young woman named Sintel searches the world for her baby dragon in a gorgeous open-source movie stream.",
                category = "trending",
                videoUrl = "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8", // Real working public HLS (Bitmovin Test)
                thumbnailUrl = "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=60",
                duration = "15m",
                year = 2024,
                rating = "PG",
                score = "9.2"
            ),
            Movie(
                id = "3",
                title = "Metropolitan Neon",
                description = "Explore a rainy neon-lit megacity in this cinematic multi-bitrate test stream simulating remote server feeds.",
                category = "library",
                videoUrl = "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8", // Real working public HLS (Unified Streaming)
                thumbnailUrl = "https://images.unsplash.com/photo-1515621061946-eff1c2a352bd?w=800&auto=format&fit=crop&q=60",
                duration = "12m",
                year = 2026,
                rating = "R",
                score = "8.9"
            ),
            Movie(
                id = "4",
                title = "Oceanic Depths",
                description = "Submerge into extreme abyssal zones and witness ancient marine life glowing in bioluminescent beauty.",
                category = "library",
                videoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", // MP4 fallback stream
                thumbnailUrl = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop&q=60",
                duration = "2h 05m",
                year = 2025,
                rating = "G",
                score = "9.5"
            ),
            Movie(
                id = "5",
                title = "The Pi Engine",
                description = "A visual documentary exploring Raspberry Pi clusters executing parallel ffmpeg pipelines over dynamic networks.",
                category = "trending",
                videoUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", // Fallback stream
                thumbnailUrl = "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=60",
                duration = "45m",
                year = 2026,
                rating = "PG-13",
                score = "9.0"
            )
        )
        movieDao.insertMovies(mockData)
        Log.d("MovieRepository", "Mock movies seeded successfully")
    }

    suspend fun clearCache() {
        movieDao.clearAllMovies()
    }
}
