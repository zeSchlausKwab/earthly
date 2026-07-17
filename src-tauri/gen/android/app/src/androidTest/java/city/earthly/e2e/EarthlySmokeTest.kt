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
    fun workspaceAppLinksRemainStableAcrossWarmNavigation() {
        earthly.openAppLink("/field-sessions")
        earthly.awaitVisible("Field sessions")
        earthly.assertContinuouslyVisible("Field sessions")

        earthly.openAppLink("/private-groups")
        earthly.awaitVisible("Private groups")
        earthly.assertContinuouslyVisible("Private groups")

        earthly.openAppLink("/drafts")
        earthly.awaitVisible("Local drafts")
        earthly.assertContinuouslyVisible("Local drafts")
    }
}
