package city.earthly.earthly_native

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class TrackSample(
    val lat: Double,
    val lon: Double,
    val alt: Double?,
    val accuracy: Double,
    val timestampMs: Long,
) {
    fun toMap(): Map<String, Any> {
        val m = mutableMapOf<String, Any>(
            "lat" to lat,
            "lon" to lon,
            "accuracy" to accuracy,
            "timestampMs" to timestampMs,
        )
        if (alt != null) m["alt"] = alt
        return m
    }
}

/**
 * Sovereign Android Foreground Service for screen-off GPS track recording
 * (zero Google Play Services — pure Android `LocationManager`).
 */
class EarthlyTrackService : Service(), LocationListener {
    companion object {
        private const val CHANNEL_ID = "earthly_gps_track_v1"
        private const val NOTIFICATION_ID = 7701

        const val ACTION_START = "city.earthly.earthly_native.TRACK_START"
        const val ACTION_PAUSE = "city.earthly.earthly_native.TRACK_PAUSE"
        const val ACTION_RESUME = "city.earthly.earthly_native.TRACK_RESUME"
        const val ACTION_STOP = "city.earthly.earthly_native.TRACK_STOP"

        @Volatile
        var isRecording: Boolean = false
            private set

        @Volatile
        var isPaused: Boolean = false
            private set

        @Volatile
        var startedAtMs: Long = 0L
            private set

        val samples: CopyOnWriteArrayList<TrackSample> = CopyOnWriteArrayList()

        @Volatile
        var onPointListener: ((TrackSample) -> Unit)? = null

        fun totalDistanceMeters(): Double {
            val pts = samples.toList()
            if (pts.size < 2) return 0.0
            var total = 0.0
            for (i in 1 until pts.size) {
                total += haversineMeters(
                    pts[i - 1].lat,
                    pts[i - 1].lon,
                    pts[i].lat,
                    pts[i].lon,
                )
            }
            return total
        }

        private fun haversineMeters(
            lat1: Double,
            lon1: Double,
            lat2: Double,
            lon2: Double,
        ): Double {
            val r = 6371000.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLon = Math.toRadians(lon2 - lon1)
            val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                sin(dLon / 2) * sin(dLon / 2)
            val c = 2 * atan2(sqrt(a), sqrt(1 - a))
            return r * c
        }
    }

    private var locationManager: LocationManager? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                samples.clear()
                startedAtMs = System.currentTimeMillis()
                isRecording = true
                isPaused = false
                promoteToForeground()
                startLocationUpdates()
            }
            ACTION_PAUSE -> {
                isPaused = true
                stopLocationUpdates()
                updateNotification()
            }
            ACTION_RESUME -> {
                if (isRecording) {
                    isPaused = false
                    startLocationUpdates()
                    updateNotification()
                }
            }
            ACTION_STOP -> {
                isRecording = false
                isPaused = false
                stopLocationUpdates()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopLocationUpdates()
        isRecording = false
        isPaused = false
        super.onDestroy()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Earthly GPS Track Recording",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Keeps field GPS track recording active while screen is off"
            }
            mgr.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, piFlags)
        val distMeters = totalDistanceMeters()
        val distLabel = if (distMeters >= 1000) {
            String.format("%.2f km", distMeters / 1000.0)
        } else {
            String.format("%.0f m", distMeters)
        }
        val statusText = if (isPaused) {
            "Paused · ${samples.size} pts · $distLabel"
        } else {
            "Recording · ${samples.size} pts · $distLabel"
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("Earthly Field Track")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun promoteToForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification() {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return
        mgr.notify(NOTIFICATION_ID, buildNotification())
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        val lm = locationManager ?: return
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2500L, 3.0f, this)
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 4000L, 5.0f, this)
            }
            val last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (last != null && samples.isEmpty()) {
                recordLocation(last)
            }
        } catch (_: SecurityException) {
        }
    }

    private fun stopLocationUpdates() {
        try {
            locationManager?.removeUpdates(this)
        } catch (_: Exception) {
        }
    }

    private fun recordLocation(loc: Location) {
        if (!isRecording || isPaused) return
        val last = samples.lastOrNull()
        if (last != null) {
            val moved = haversineMeters(last.lat, last.lon, loc.latitude, loc.longitude)
            if (moved < 2.0 && (System.currentTimeMillis() - last.timestampMs) < 10_000L) {
                return
            }
        }
        val sample = TrackSample(
            lat = loc.latitude,
            lon = loc.longitude,
            alt = if (loc.hasAltitude()) loc.altitude else null,
            accuracy = loc.accuracy.toDouble(),
            timestampMs = if (loc.time > 0) loc.time else System.currentTimeMillis(),
        )
        samples.add(sample)
        updateNotification()
        onPointListener?.invoke(sample)
    }

    override fun onLocationChanged(location: Location) {
        recordLocation(location)
    }

    @Deprecated("Deprecated in API 29")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}

    override fun onProviderEnabled(provider: String) {}

    override fun onProviderDisabled(provider: String) {}
}
