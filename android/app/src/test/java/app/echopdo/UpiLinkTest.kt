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

    @Test fun theNearestOfTwoSameAmountNoticesIsTaken() {
        seed(notice("out", 30.0, "", now - 6 * 60_000), notice("out", 30.0, "", now - 1 * 60_000))
        val r = UpiLink.claimNotice(ctx, "out", 30.0, now)!!
        assertEquals(now - 60_000, r.optLong("at"))
        assertEquals(now - 6 * 60_000, UpiLink.claimNotice(ctx, "out", 30.0, now)!!.optLong("at")) // then the other
        assertNull(UpiLink.claimNotice(ctx, "out", 30.0, now))
    }

    @Test fun aNamelessNoticeIsMatchedToItsSmsOnlyOnce() {
        Store.noteSmsPayment(ctx, now - 60_000, "out", 30.0, false)
        assertEquals(true, Store.claimSmsPayment(ctx, "out", 30.0, now, UpiLink.SMS_PAIR_MS))
        // A second notice for the same amount has no SMS of its own left to match.
        assertEquals(false, Store.claimSmsPayment(ctx, "out", 30.0, now + 5 * 60_000, UpiLink.SMS_PAIR_MS))
    }

    @Test fun smsFarAwayInTimeOrOfAnotherAmountIsNotTheSamePayment() {
        Store.noteSmsPayment(ctx, now - 10 * 60_000, "out", 30.0, false)
        Store.noteSmsPayment(ctx, now - 30_000, "out", 40.0, false)
        assertEquals(false, Store.claimSmsPayment(ctx, "out", 30.0, now, UpiLink.SMS_PAIR_MS))
        assertEquals(false, Store.claimSmsPayment(ctx, "in", 40.0, now, UpiLink.SMS_PAIR_MS))
    }

    @Test fun anSmsAlreadyNamedByANoticeIsNotAvailableAgain() {
        Store.noteSmsPayment(ctx, now - 30_000, "out", 40.0, true)
        assertEquals(false, Store.claimSmsPayment(ctx, "out", 40.0, now, UpiLink.SMS_PAIR_MS))
    }

    @Test fun aNamelessNoticeIsSettledSoonerThanANamedOne() {
        seed(notice("out", 30.0, "", now - 60_000))
        val soon = UpiLink.nextDue(ctx)
        assertEquals(true, soon in 100_000L..130_000L) // about 3 min after it was posted
        seed(notice("out", 30.0, "Demo Stores", now - 60_000))
        assertEquals(true, UpiLink.nextDue(ctx) > 500_000L)
    }

    @Test fun walletPaymentsAreNamedForTheirApp() {
        assertEquals("Paytm Pocket Money", UpiLink.labelFor("Paytm", "₹40 spent using Pocket Money · 9000000001 made a payment using Pocket Money."))
        assertEquals("GPay payment", UpiLink.labelFor("GPay", "₹90 paid"))
    }

    // Payments the SMS log already shows as added are known to the pairing list, so an old notice isn't added twice.
    @Test fun anOldSmsInTheLogIsFoundWhenItsNoticeIsReadLater() {
        val at = now - 4 * 60_000
        Store.logSms(ctx, at, "JK-BOBSMS-S", "Rs.40.00 Dr. from A/C XXXXXX1234 and Cr. to demo.person@ptyes. Ref:111122223399. AvlBal:Rs10000.00(2026:09:09 12:34:56). Not you? Call 18005700/5000-BOB", "sent", "Money out · ₹40 · ••1234 · added")
        Store.seedSmsRecentFromLog(ctx)
        assertEquals(true, Store.claimSmsPayment(ctx, "out", 40.0, at + 30_000, UpiLink.SMS_PAIR_MS))
        assertEquals(false, Store.claimSmsPayment(ctx, "out", 40.0, at + 60_000, UpiLink.SMS_PAIR_MS)) // only once
        Store.seedSmsRecentFromLog(ctx) // runs once only
        assertEquals(false, Store.claimSmsPayment(ctx, "out", 40.0, at + 60_000, UpiLink.SMS_PAIR_MS))
    }
}
