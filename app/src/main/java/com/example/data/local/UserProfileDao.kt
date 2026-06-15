package com.example.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.data.model.UserProfile
import com.example.data.model.ProfileMovieState
import kotlinx.coroutines.flow.Flow

@Dao
interface UserProfileDao {
    @Query("SELECT * FROM user_profiles WHERE userEmail = :email")
    fun getProfilesForUser(email: String): Flow<List<UserProfile>>

    @Query("SELECT * FROM user_profiles WHERE id = :profileId")
    suspend fun getProfileById(profileId: String): UserProfile?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProfile(profile: UserProfile)

    @Query("DELETE FROM user_profiles WHERE id = :profileId")
    suspend fun deleteProfile(profileId: String)

    @Query("SELECT * FROM profile_movie_state WHERE profileId = :profileId")
    fun getAllStatesForProfile(profileId: String): Flow<List<ProfileMovieState>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProfileMovieState(state: ProfileMovieState)

    @Query("UPDATE profile_movie_state SET progress = :progress, progressSeconds = :progressSeconds, durationSeconds = :durationSeconds, lastWatchedTime = :timestamp WHERE profileId = :profileId AND movieId = :movieId")
    suspend fun updateProfilePlaybackProgress(profileId: String, movieId: String, progress: Float, progressSeconds: Long, durationSeconds: Long, timestamp: Long)

    @Query("UPDATE profile_movie_state SET isFavorite = :isFavorite WHERE profileId = :profileId AND movieId = :movieId")
    suspend fun updateProfileFavoriteStatus(profileId: String, movieId: String, isFavorite: Boolean)

    @Query("SELECT * FROM profile_movie_state WHERE profileId = :profileId AND movieId = :movieId")
    suspend fun getProfileMovieState(profileId: String, movieId: String): ProfileMovieState?
}
