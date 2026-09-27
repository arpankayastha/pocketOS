package app.echopdo

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LaunchTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private fun find(root: View, text: String): TextView? {
        if (root is TextView && root.text.toString().startsWith(text)) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) find(root.getChildAt(i), text)?.let { return it }
        return null
    }

    @Test fun opensAndExplainsWhenNoBrowserAnswers() {
        val act = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        ShadowLooper.idleMainLooper(9, java.util.concurrent.TimeUnit.SECONDS)
        // No Chrome in the test JVM: after 8 s the screen explains and offers alternatives.
        assertNotNull(find(act.window.decorView, "Try again"))
        assertNotNull(find(act.window.decorView, "Open in Chrome"))
    }

    @Test fun showsLastCrash() {
        Crash.save(ctx, IllegalStateException("boom"))
        val act = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        assertNotNull(find(act.window.decorView, "eChopdo stopped last time"))
        assertNotNull(find(act.window.decorView, "Copy error report"))
    }
}
