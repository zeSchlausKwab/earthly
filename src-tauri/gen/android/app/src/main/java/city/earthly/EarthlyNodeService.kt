package city.earthly

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.util.concurrent.TimeUnit

class EarthlyNodeService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var stopAtExpiry: Runnable? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopSharing()
      ACTION_START -> {
        val address = intent.getStringExtra(EXTRA_ADDRESS).orEmpty()
        val expiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0)
        if (address.isBlank() || expiresAt <= nowSeconds()) {
          stopSharing()
          return START_NOT_STICKY
        }
        startSharing(address, expiresAt)
      }
      else -> stopSharing()
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopAtExpiry?.let(handler::removeCallbacks)
    stopAtExpiry = null
    super.onDestroy()
  }

  private fun startSharing(address: String, expiresAt: Long) {
    val notification = buildNotification(address, expiresAt)
    val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    } else {
      0
    }
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      serviceType
    )

    stopAtExpiry?.let(handler::removeCallbacks)
    val delayMillis = TimeUnit.SECONDS.toMillis((expiresAt - nowSeconds()).coerceAtLeast(1))
    stopAtExpiry = Runnable { stopSharing() }.also { handler.postDelayed(it, delayMillis) }
  }

  private fun stopSharing() {
    stopAtExpiry?.let(handler::removeCallbacks)
    stopAtExpiry = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun buildNotification(address: String, expiresAt: Long): Notification {
    val openApp = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      openApp,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val remainingMinutes = ((expiresAt - nowSeconds()) / 60).coerceAtLeast(1)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_earthly_sharing)
      .setContentTitle(getString(R.string.local_sharing_title))
      .setContentText(
        getString(R.string.local_sharing_description, address, remainingMinutes)
      )
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.local_sharing_channel),
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = getString(R.string.local_sharing_channel_description)
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun nowSeconds(): Long = System.currentTimeMillis() / 1000

  companion object {
    const val ACTION_START = "city.earthly.action.START_LOCAL_SHARING"
    const val ACTION_STOP = "city.earthly.action.STOP_LOCAL_SHARING"
    const val EXTRA_ADDRESS = "address"
    const val EXTRA_EXPIRES_AT = "expiresAt"
    private const val CHANNEL_ID = "earthly_local_sharing"
    private const val NOTIFICATION_ID = 4107
  }
}
