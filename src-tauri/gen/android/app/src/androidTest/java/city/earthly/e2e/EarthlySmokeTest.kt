package city.earthly.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class EarthlySmokeTest {
    private val earthly = EarthlyDevice()

    @Test
    fun privateGroupsAppLinkRemainsStable() {
        earthly.openAppLink("/private-groups")
        earthly.awaitVisible("Private groups")
        earthly.assertContinuouslyVisible("Private groups")
    }

    @Test
    fun fieldSessionsAppLinkRemainsStable() {
        earthly.openAppLink("/field-sessions")
        earthly.awaitVisible("Field sessions")
        earthly.assertContinuouslyVisible("Field sessions")
    }
}
