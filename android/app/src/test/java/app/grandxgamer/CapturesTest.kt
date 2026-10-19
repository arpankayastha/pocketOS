package app.grandxgamer

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Only money received goes to the shop; money out is logged on the phone and never sent. Made-up SMS only.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CapturesTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val credit = "Dear Customer, Acct XX1234 is credited with Rs 160.00 on 19-Oct-26 from TEST PAYER (UPI Ref No 600011112222). -Test Bank"
    private val debit = "Dear Customer, Acct XX1234 is debited with Rs 75.00 on 19-Oct-26 towards UPI/600033334444/TEST SHOP. -Test Bank"

    @Before fun setUp() {
        Store.unpair(ctx); Store.clearSeen(ctx); Store.clearSmsLog(ctx)
        Store.savePairing(ctx, "test-token", "Test Shop")
        Api.endpoint = "http://127.0.0.1:9/none" // offline: the payment is queued
    }

    @Test fun creditIsQueuedWithParsedFieldsOnly() {
        assertTrue(Captures.handle(ctx, "AD-TESTBK", credit, 1_760_000_000_000, notify = false))
        val q = Store.queue(ctx)
        assertEquals(1, q.length())
        val sent = q.getJSONObject(0)
        assertEquals("capture", sent.getString("action"))
        assertEquals(160.0, sent.getDouble("amount"), 0.001)
        assertFalse(sent.toString().contains("Dear Customer")) // never the SMS text
        // The same SMS again (look back) is not sent twice.
        assertFalse(Captures.handle(ctx, "AD-TESTBK", credit, 1_760_000_000_000, notify = false))
    }

    @Test fun moneyOutIsNeverSent() {
        assertFalse(Captures.handle(ctx, "AD-TESTBK", debit, 1_760_000_000_000, notify = false))
        assertEquals(0, Store.queue(ctx).length())
        assertEquals("skipped", Store.smsLog(ctx).getJSONObject(0).getString("outcome"))
    }
}
