package com.example.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squareup.moshi.JsonClass

@Entity(tableName = "movies")
@JsonClass(generateAdapter = true)
data class Movie(
    @PrimaryKey val id: String,
    val title: String,
    val description: String,
    val category: String, // "trending", "continue_watching", "library"
    val videoUrl: String,
    val thumbnailUrl: String,
    val duration: String, // e.g. "1h 45m"
    val year: Int,
    val rating: String,   // e.g. "PG-13" or "R"
    val score: String = "9.5", // Rotten or IMDb score
    // User personal state (persisted locally via Room)
    val progress: Float = 0f, // 0.0 to 1.0 (percent watched)
    val progressSeconds: Long = 0L, // exact playback second
    val durationSeconds: Long = 0L, // total seconds
    val lastWatchedTime: Long = 0L, // timestamp to sort "continue watching"
    val isFavorite: Boolean = false
) {
    val isRecentlyWatched: Boolean
        get() = lastWatchedTime > 0
}

@JsonClass(generateAdapter = true)
data class PiDeviceStatus(
    val serverName: String,
    val version: String,
    val ffmpegAvailable: Boolean,
    val diskFreeSpace: String,
    val localAddress: String,
    val isRemoteSecure: Boolean
)

@JsonClass(generateAdapter = true)
data class AuthResponse(
    val token: String,
    val userEmail: String,
    val message: String? = null
)
