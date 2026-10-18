package app.echopdo

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// How a GPay / Paytm notice and its bank SMS are matched on the phone. Names and amounts are made up.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpiLinkTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val now = System.currentTimeMillis()

    private fun notice(direction: String, amount: Double, name: String, at: Long, state: String = "open") = JSONObject()
        .put("key", at).put("at", at).put("direction", direction).put("amount", amount).put("name", name).put("app", "GPay").put("state", state).put("shown", "x")

    private fun seed(vararg n: JSONObject) { Store.setUpiRecent(ctx, JSONArray().also { a -> n.forEach { a.put(it) } }) }

    @Test fun smsGetsTheNoticesNameOnce() {
        seed(notice("out", 250.0, "Demo Stores", now - 60_000))
        assertEquals("Demo Stores", UpiLink.nameFor(ctx, "out", 250.0, now))
        assertNull(UpiLink.nameFor(ctx, "out", 250.0, now)) // already used
    }

    @Test fun differentAmountDirectionOrTimeDoesNotMatch() {
        seed(notice("out", 250.0, "Demo Stores", now - 60_000))
        assertNull(UpiLink.nameFor(ctx, "out", 251.0, now))
        assertNull(UpiLink.nameFor(ctx, "in", 250.0, now))
        assertNull(UpiLink.nameFor(ctx, "out", 250.0, now + UpiLink.WINDOW_MS + 60_000))
    }

    @Test fun picksTheRightOneOfTwo() {
        seed(notice("out", 100.0, "Demo Chai", now - 120_000), notice("out", 250.0, "Demo Stores", now - 60_000))
        assertEquals("Demo Stores", UpiLink.nameFor(ctx, "out", 250.0, now))
        assertEquals("Demo Chai", UpiLink.nameFor(ctx, "out", 100.0, now))
    }

    @Test fun billsAndOddDirectionsAreLeftAlone() {
        seed(notice("out", 250.0, "Demo Stores", now))
        assertNull(UpiLink.nameFor(ctx, "bill", 250.0, now))
    }

    @Test fun oldNoticesAreForgotten() {
        seed(notice("out", 250.0, "Demo Stores", now - 25 * 3600_000L))
        assertEquals(0, Store.upiRecent(ctx).length())
    }
}
