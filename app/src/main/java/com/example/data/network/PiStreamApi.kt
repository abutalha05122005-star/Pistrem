package com.example.data.network

import com.example.data.model.AuthResponse
import com.example.data.model.Movie
import com.example.data.model.PiDeviceStatus
import com.example.data.model.UserProfile
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

interface PiStreamApi {

    @POST("auth/login")
    suspend fun login(
        @Body credentials: Map<String, String>
    ): AuthResponse

    @POST("auth/register")
    suspend fun register(
        @Body credentials: Map<String, String>
    ): AuthResponse

    @GET("media/list")
    suspend fun getMediaList(
        @Header("Authorization") token: String
    ): List<Movie>

    @GET("device/status")
    suspend fun getDeviceStatus(): PiDeviceStatus

    @POST("device/sync")
    suspend fun syncPlayback(
        @Header("Authorization") token: String,
        @Body syncData: Map<String, String>
    ): Map<String, String>

    @GET("profiles/list")
    suspend fun getProfilesList(
        @Header("Authorization") token: String
    ): List<UserProfile>

    @POST("profiles/save")
    suspend fun saveProfile(
        @Header("Authorization") token: String,
        @Body profile: UserProfile
    ): UserProfile

    @POST("profiles/delete/{id}")
    suspend fun deleteProfile(
        @Header("Authorization") token: String,
        @Path("id") profileId: String
    ): Map<String, String>
}
