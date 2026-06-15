package com.example.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.example.data.model.Movie
import com.example.data.model.UserProfile
import com.example.data.model.ProfileMovieState

@Database(entities = [Movie::class, UserProfile::class, ProfileMovieState::class], version = 2, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract val movieDao: MovieDao
    abstract val userProfileDao: UserProfileDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "pistream_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
