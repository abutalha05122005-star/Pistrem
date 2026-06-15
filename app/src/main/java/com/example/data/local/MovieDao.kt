package com.example.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.example.data.model.Movie
import kotlinx.coroutines.flow.Flow

@Dao
interface MovieDao {
    @Query("SELECT * FROM movies ORDER BY id ASC")
    fun getAllMovies(): Flow<List<Movie>>

    @Query("SELECT * FROM movies WHERE id = :id")
    fun getMovieById(id: String): Flow<Movie?>

    @Query("SELECT * FROM movies WHERE id = :id")
    suspend fun getMovieByIdSuspend(id: String): Movie?

    @Query("SELECT * FROM movies WHERE lastWatchedTime > 0 ORDER BY lastWatchedTime DESC")
    fun getContinueWatchingMovies(): Flow<List<Movie>>

    @Query("SELECT * FROM movies WHERE isFavorite = 1")
    fun getFavoriteMovies(): Flow<List<Movie>>

    // Profile-specific dynamic mappings
    @Query("""
        SELECT 
            movies.id, movies.title, movies.description, movies.category, 
            movies.videoUrl, movies.thumbnailUrl, movies.duration, movies.year, 
            movies.rating, movies.score,
            COALESCE(state.progress, 0.0) AS progress,
            COALESCE(state.progressSeconds, 0) AS progressSeconds,
            COALESCE(state.durationSeconds, 0) AS durationSeconds,
            COALESCE(state.lastWatchedTime, 0) AS lastWatchedTime,
            COALESCE(state.isFavorite, 0) AS isFavorite
        FROM movies
        LEFT JOIN profile_movie_state AS state 
          ON movies.id = state.movieId AND state.profileId = :profileId
        ORDER BY movies.id ASC
    """)
    fun getAllMoviesForProfile(profileId: String): Flow<List<Movie>>

    @Query("""
        SELECT 
            movies.id, movies.title, movies.description, movies.category, 
            movies.videoUrl, movies.thumbnailUrl, movies.duration, movies.year, 
            movies.rating, movies.score,
            COALESCE(state.progress, 0.0) AS progress,
            COALESCE(state.progressSeconds, 0) AS progressSeconds,
            COALESCE(state.durationSeconds, 0) AS durationSeconds,
            COALESCE(state.lastWatchedTime, 0) AS lastWatchedTime,
            COALESCE(state.isFavorite, 0) AS isFavorite
        FROM movies
        INNER JOIN profile_movie_state AS state 
          ON movies.id = state.movieId AND state.profileId = :profileId
        WHERE state.lastWatchedTime > 0
        ORDER BY state.lastWatchedTime DESC
    """)
    fun getContinueWatchingMoviesForProfile(profileId: String): Flow<List<Movie>>

    @Query("""
        SELECT 
            movies.id, movies.title, movies.description, movies.category, 
            movies.videoUrl, movies.thumbnailUrl, movies.duration, movies.year, 
            movies.rating, movies.score,
            COALESCE(state.progress, 0.0) AS progress,
            COALESCE(state.progressSeconds, 0) AS progressSeconds,
            COALESCE(state.durationSeconds, 0) AS durationSeconds,
            COALESCE(state.lastWatchedTime, 0) AS lastWatchedTime,
            COALESCE(state.isFavorite, 0) AS isFavorite
        FROM movies
        INNER JOIN profile_movie_state AS state 
          ON movies.id = state.movieId AND state.profileId = :profileId
        WHERE state.isFavorite = 1
    """)
    fun getFavoriteMoviesForProfile(profileId: String): Flow<List<Movie>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMovies(movies: List<Movie>)

    @Update
    suspend fun updateMovie(movie: Movie)

    @Query("UPDATE movies SET progress = :progress, progressSeconds = :progressSeconds, durationSeconds = :durationSeconds, lastWatchedTime = :timestamp WHERE id = :id")
    suspend fun updatePlaybackProgress(id: String, progress: Float, progressSeconds: Long, durationSeconds: Long, timestamp: Long)

    @Query("UPDATE movies SET isFavorite = :isFavorite WHERE id = :id")
    suspend fun updateFavoriteStatus(id: String, isFavorite: Boolean)

    @Query("DELETE FROM movies")
    suspend fun clearAllMovies()
}
