package city.earthly

import android.Manifest
import android.app.Activity
import android.content.Intent
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class StartSharingArgs {
  lateinit var address: String
  var expiresAt: Long = 0
}

@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.POST_NOTIFICATIONS],
      alias = "notifications"
    )
  ]
)
class EarthlyLifecyclePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun startSharing(invoke: Invoke) {
    val args = invoke.parseArgs(StartSharingArgs::class.java)
    if (args.expiresAt <= System.currentTimeMillis() / 1000) {
      invoke.reject("Nearby sharing expiry must be in the future", "invalid-sharing-expiry")
      return
    }
    val intent = Intent(activity, EarthlyNodeService::class.java).apply {
      action = EarthlyNodeService.ACTION_START
      putExtra(EarthlyNodeService.EXTRA_ADDRESS, args.address)
      putExtra(EarthlyNodeService.EXTRA_EXPIRES_AT, args.expiresAt)
    }
    try {
      ContextCompat.startForegroundService(activity, intent)
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("Could not keep nearby sharing active", "foreground-service-failed", error)
    }
  }

  @Command
  fun stopSharing(invoke: Invoke) {
    activity.stopService(Intent(activity, EarthlyNodeService::class.java))
    invoke.resolve()
  }
}
