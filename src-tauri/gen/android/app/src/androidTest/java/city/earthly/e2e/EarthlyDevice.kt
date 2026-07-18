package city.earthly.e2e

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue

class EarthlyDevice {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)

    fun openAppLink(path: String) {
        val url = Uri.parse("https://earthly.city$path")
        val intent = Intent(Intent.ACTION_VIEW, url).apply {
            setClassName(PACKAGE, "$PACKAGE.MainActivity")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        instrumentation.targetContext.startActivity(intent)
        assertTrue(
            "Earthly did not become the foreground app for $url",
            device.wait(Until.hasObject(By.pkg(PACKAGE).depth(0)), APP_START_TIMEOUT_MS),
        )
        dismissTourIfPresent()
    }

    fun awaitVisible(label: String, timeoutMs: Long = SURFACE_TIMEOUT_MS): UiObject2 {
        val exactText = device.wait(Until.findObject(By.text(label)), timeoutMs)
        val objectOnScreen = exactText
            ?: device.wait(Until.findObject(By.desc(label)), 1_000)
            ?: device.wait(Until.findObject(By.textContains(label)), 1_000)
        assertNotNull("Expected to find '$label' in the Earthly UI", objectOnScreen)
        return objectOnScreen!!
    }

    fun assertContinuouslyVisible(label: String, durationMs: Long = STABILITY_WINDOW_MS) {
        val deadline = SystemClock.uptimeMillis() + durationMs
        var missingSince: Long? = null
        while (SystemClock.uptimeMillis() < deadline) {
            if (hasLabel(label)) {
                missingSince = null
            } else {
                val now = SystemClock.uptimeMillis()
                val firstMissing = missingSince ?: now.also { missingSince = it }
                assertTrue(
                    "'$label' disappeared for more than ${MAX_ACCESSIBILITY_GAP_MS}ms",
                    now - firstMissing < MAX_ACCESSIBILITY_GAP_MS,
                )
            }
            assertFalse("Earthly displayed its runtime error overlay", hasLabel("Runtime Error"))
            SystemClock.sleep(STABILITY_POLL_MS)
        }
        awaitVisible(label, MAX_ACCESSIBILITY_GAP_MS)
    }

    fun pressBack() {
        device.pressBack()
        device.waitForIdle()
    }

    private fun dismissTourIfPresent() {
        val close = device.findObject(By.desc("Close")) ?: device.findObject(By.text("Close"))
        close?.click()
        if (close != null) device.waitForIdle()
    }

    private fun hasLabel(label: String): Boolean =
        device.hasObject(By.text(label)) ||
            device.hasObject(By.desc(label)) ||
            device.hasObject(By.textContains(label))

    companion object {
        private const val PACKAGE = "city.earthly"
        private const val APP_START_TIMEOUT_MS = 20_000L
        private const val SURFACE_TIMEOUT_MS = 20_000L
        private const val STABILITY_WINDOW_MS = 7_000L
        private const val STABILITY_POLL_MS = 200L
        private const val MAX_ACCESSIBILITY_GAP_MS = 1_500L
    }
}
