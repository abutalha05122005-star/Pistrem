package com.example.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squareup.moshi.JsonClass

@Entity(tableName = "user_profiles")
@JsonClass(generateAdapter = true)
data class UserProfile(
    @PrimaryKey val id: String, // format: "${email}_${profileName_lowercase_or_timestamp}"
    val userEmail: String,
    val name: String,
    val avatarUrl: String, // "avatar_red", "avatar_blue", "avatar_green", "avatar_amber", "avatar_pink"
    val isKids: Boolean = false,
    val favoriteGenre: String = "Sci-Fi" // e.g. "Sci-Fi", "Action", "Documentaries", "Nature", "Kids"
)

@Entity(
    tableName = "profile_movie_state",
    primaryKeys = ["profileId", "movieId"]
)
@JsonClass(generateAdapter = true)
data class ProfileMovieState(
    val profileId: String,
    val movieId: String,
    val progress: Float = 0f,
    val progressSeconds: Long = 0L,
    val durationSeconds: Long = 0L,
    val lastWatchedTime: Long = 0L,
    val isFavorite: Boolean = false
)
