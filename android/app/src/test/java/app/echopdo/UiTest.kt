package app.echopdo

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowToast
import java.io.File

// Made-up household data only.
private val CONFIG = """
{"device":{"name":"Test phone","default_target":"hisab"},"household":{"name":"Home","color":"#34d399"},
 "hisab":{"books":[{"id":"b1","name":"Daily","kind":"daily"},{"id":"b2","name":"Diwali","kind":"occasion"}],
  "out":[{"name":"Groceries","icon":"🥦"},{"name":"Food","icon":"🍽️"},{"name":"Fuel","icon":"⛽"},{"name":"Medical","icon":"💊"},{"name":"Other","icon":"📦"}],
  "in":[{"name":"Shagun","icon":"🧧"},{"name":"Refund","icon":"↩️"}],"sources":["Cash","UPI","Card"]},
 "budget":{"expense":[{"id":"c1","name":"Bills","color":"#3987e5"},{"id":"c2","name":"Shopping","color":"#d95926"}],
  "income":[{"id":"c3","name":"Salary","color":"#34d399"}],"accounts":[{"id":"a1","name":"Cash","color":"#8b93a5"}]},
 "frequent":[{"direction":"out","amount":60,"category":"Groceries","source":"Cash","icon":"🥦","n":5},
  {"direction":"out","amount":500,"category":"Fuel","source":"UPI","icon":"⛽","n":3}],
 "pending":[{"id":"cap1","direction":"out","amount":270,"date":"2026-09-27","account_hint":"5678","card":false,"payee":"DEMO STORE","bank":"Federal Bank",
   "suggestion":{"target":"hisab","category":"Food","label":"Food","icon":"🍽️","source":"UPI","auto":false},"account_id":null,"match":null},
  {"id":"cap2","direction":"in","amount":1500,"date":"2026-09-26","account_hint":"4321","card":false,"payee":"DEMO SENDER","bank":"ICICI","suggestion":null,"account_id":null,"match":null}],
 "today":"2026-09-28"}
"""

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w384dp-h832dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UiTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Before fun setUp() {
        androidx.work.testing.WorkManagerTestInitHelper.initializeTestWorkManager(ctx)
        Api.endpoint = "http://127.0.0.1:9/offline" // no server in tests: saves go to the offline queue
        Store.unpair(ctx)
        Store.savePairing(ctx, "test-token", "Home")
        Store.saveConfig(ctx, JSONObject(CONFIG))
    }

    private fun find(root: View, text: String): TextView? {
        if (root is TextView && root.text.toString() == text) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) find(root.getChildAt(i), text)?.let { return it }
        return null
    }
    private fun click(root: View, text: String) { assertNotNull("no view \"$text\"", find(root, text)); find(root, text)!!.performClick(); ShadowLooper.idleMainLooper() }

    private fun shot(v: View, name: String) {
        val dir = System.getProperty("echopdo.shots").orEmpty().ifEmpty { return }
        val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp); c.drawColor(0xFF1A2230.toInt()); v.draw(c)
        File(dir).mkdirs(); File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun waitFor(cond: () -> Boolean) {
        repeat(100) { if (cond()) return; Thread.sleep(50); ShadowLooper.idleMainLooper() }
    }

    @Test fun quickAddHisabSavesOffline() {
        val act = Robolectric.buildActivity(QuickAddActivity::class.java, Intent(ctx, QuickAddActivity::class.java).putExtra("direction", "out")).setup().get()
        val root = act.window.decorView
        assertNotNull(find(root, "eChopdo · Home"))
        listOf("1", "2", "0", "+", "4", "5").forEach { click(root, it) }
        assertNotNull(find(root, "₹165"))
        click(root, "🥦  Groceries")
        click(root, "UPI")
        click(root, "🎉 Diwali")
        shot(root, "1-quickadd-hisab")
        click(root, "Save")
        waitFor { Store.queue(ctx).length() == 1 }
        val q = Store.queue(ctx)
        assertEquals(1, q.length())
        val e = q.getJSONObject(0)
        assertEquals("hisab", e.getString("target")); assertEquals("out", e.getString("direction"))
        assertEquals(165.0, e.getDouble("amount"), 0.0); assertEquals("Groceries", e.getString("category"))
        assertEquals("UPI", e.getString("source")); assertEquals("b2", e.getString("book_id"))
        waitFor { ShadowToast.getTextOfLatestToast() != null }
        assertTrue(ShadowToast.getTextOfLatestToast().contains("offline"))
        assertTrue(act.isFinishing)
    }

    @Test fun quickAddBudgetAndReceived() {
        val act = Robolectric.buildActivity(QuickAddActivity::class.java, Intent(ctx, QuickAddActivity::class.java).putExtra("direction", "in")).setup().get()
        val root = act.window.decorView
        assertNotNull(find(root, "🧧  Shagun"))
        click(root, "Budget")
        assertNotNull(find(root, "Income"))
        assertNotNull(find(root, "●  Salary"))
        click(root, "Spent".let { "Expense" })
        click(root, "●  Bills"); click(root, "Cash")
        listOf("2", "5", "0", "0").forEach { click(root, it) }
        shot(root, "2-quickadd-budget")
        click(root, "Save & next")
        waitFor { Store.queue(ctx).length() == 1 }
        val e = Store.queue(ctx).getJSONObject(0)
        assertEquals("budget", e.getString("target")); assertEquals("expense", e.getString("kind"))
        assertEquals("c1", e.getString("category_id")); assertEquals("a1", e.getString("account_id"))
        assertEquals(2500.0, e.getDouble("amount"), 0.0)
        waitFor { find(root, "₹0") != null } // the UI resets after the save returns
        assertTrue(!act.isFinishing) // Save & next keeps the sheet open
        assertNotNull(find(root, "₹0"))
    }

    @Test fun emptyAmountIsRejected() {
        val act = Robolectric.buildActivity(QuickAddActivity::class.java).setup().get()
        click(act.window.decorView, "Save")
        assertNotNull(find(act.window.decorView, "Enter an amount."))
        assertEquals(0, Store.queue(ctx).length())
    }

    private fun host(v: View, wDp: Int, hDp: Int): FrameLayout {
        val host = FrameLayout(ctx)
        host.addView(v, FrameLayout.LayoutParams(ctx.dp(wDp), ctx.dp(hDp)))
        host.measure(View.MeasureSpec.makeMeasureSpec(ctx.dp(wDp), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(ctx.dp(hDp), View.MeasureSpec.EXACTLY))
        host.layout(0, 0, ctx.dp(wDp), ctx.dp(hDp))
        return host
    }

    @Test fun widgetShowsButtonsAndFrequent() {
        val v = QuickWidget.views(ctx).apply(ctx, FrameLayout(ctx))
        val host = host(v, 340, 150)
        assertNotNull(find(v, "Home")); assertNotNull(find(v, "· Hisab")); assertNotNull(find(v, "H"))
        assertEquals(View.VISIBLE, v.findViewById<View>(R.id.wOut).visibility)
        assertEquals("Spent", v.findViewById<TextView>(R.id.wOutLabel).text.toString())
        assertEquals("Received", v.findViewById<TextView>(R.id.wInLabel).text.toString())
        assertEquals(View.GONE, v.findViewById<View>(R.id.wPresets).visibility) // manual only: no suggestion chips
        assertEquals("2 to add", v.findViewById<TextView>(R.id.wBadge).text.toString())
        assertEquals(View.GONE, v.findViewById<View>(R.id.wCaps).visibility) // short widget: no payment rows
        shot(host, "3-widget")

        // Taller widget: bank payments waiting to be added, with a one-tap ✓ for known payees.
        val tall = QuickWidget.large(ctx, android.os.Bundle().apply { putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 230) }).apply(ctx, FrameLayout(ctx))
        val tallHost = host(tall, 340, 240)
        assertEquals(View.VISIBLE, tall.findViewById<View>(R.id.wCaps).visibility)
        assertEquals("−₹270  DEMO STORE", tall.findViewById<TextView>(R.id.c0t).text.toString())
        assertEquals("✓ 🍽️", tall.findViewById<TextView>(R.id.c0a).text.toString())
        assertEquals("+₹1,500  DEMO SENDER", tall.findViewById<TextView>(R.id.c1t).text.toString())
        assertEquals("Add", tall.findViewById<TextView>(R.id.c1a).text.toString())
        shot(tallHost, "3b-widget-tall")

        val small = QuickWidget.small(ctx).apply(ctx, FrameLayout(ctx))
        val smallHost = host(small, 150, 72)
        assertEquals("2", small.findViewById<TextView>(R.id.sBadge).text.toString())
        assertEquals(View.VISIBLE, small.findViewById<View>(R.id.sBadge).visibility)
        shot(smallHost, "3c-widget-small")

        Store.unpair(ctx)
        val u = QuickWidget.views(ctx).apply(ctx, FrameLayout(ctx))
        assertEquals(View.VISIBLE, u.findViewById<View>(R.id.wPair).visibility)
        assertEquals(View.GONE, u.findViewById<View>(R.id.wButtons).visibility)
    }

    @Test fun captureModeSheet() {
        val cap = JSONObject(CONFIG).getJSONArray("pending").getJSONObject(0)
        val act = Robolectric.buildActivity(QuickAddActivity::class.java, Captures.chooseIntent(ctx, cap)).setup().get()
        val root = act.window.decorView
        assertNotNull(find(root, "₹270"))
        assertNotNull(find(root, "Federal Bank ·5678 27 Sep · from bank SMS"))
        assertNotNull(find(root, "Add")); assertNotNull(find(root, "Ignore"))
        assertEquals(View.GONE, find(root, "7")!!.let { (it.parent as View).visibility }) // no keypad: the amount is from the SMS
        assertNotNull(find(root, "Always add DEMO STORE like this"))
        shot(root, "6-capture")
        click(root, "Add")
        waitFor { find(root, "No internet — try again.") != null } // tests have no server
        assertNotNull(find(root, "No internet — try again."))
    }

    @Test fun autoAddedPaymentCanBeChangedOrRemoved() {
        val cap = JSONObject(CONFIG).getJSONArray("pending").getJSONObject(1)
            .put("guess", JSONObject().put("target", "hisab").put("category", "Shagun").put("label", "Shagun")).put("refile", true)
        val act = Robolectric.buildActivity(QuickAddActivity::class.java, Captures.chooseIntent(ctx, cap)).setup().get()
        val root = act.window.decorView
        assertNotNull(find(root, "Save")); assertNotNull(find(root, "Remove"))
        assertNotNull(find(root, "DEMO SENDER")) // note = the payee / UPI id
        assertNotNull(find(root, "🧧  Shagun"))
    }

    @Test fun smsIsParsedQueuedOfflineAndNotSentTwice() {
        val sms = "Debited Rs 270.00 from a/c X5678 on 23Sep26 19:53 via UPI to DEMO STORE D. Ref 315300000003.Bal Rs 342.77. Not you?Call 18004251199 -Federal Bank"
        assertTrue(Captures.handle(ctx, "AD-FEDBNK-T", sms, System.currentTimeMillis()))
        val q = Store.queue(ctx)
        assertEquals(1, q.length())
        val e = q.getJSONObject(0)
        assertEquals("capture", e.getString("action")); assertEquals(270.0, e.getDouble("amount"), 0.0)
        assertEquals("DEMO STORE D", e.getString("payee")); assertEquals("315300000003", e.getString("ref")); assertEquals("2026-09-23", e.getString("date"))
        assertTrue(!e.has("body") && !e.toString().contains("Bal Rs")) // the SMS text itself is never sent
        assertTrue(!Captures.handle(ctx, "AD-FEDBNK-T", sms, System.currentTimeMillis())) // same ref again → ignored
        assertTrue(!Captures.handle(ctx, "+919000000001", "Debited Rs 50 from a/c X1 to you", 0L)) // not a bank sender
        // A card SMS with no reference is also remembered (it used to be re-sent on every look-back).
        val card = "INR 768.00 spent using ICICI Bank Card XX1234 on 25-Sep-26 on IND*DEMO FUELS. Avl Limit: INR 1,00,000."
        assertTrue(Captures.handle(ctx, "JD-ICICIT-S", card, 0L))
        assertTrue(!Captures.handle(ctx, "JD-ICICIT-S", card, 0L))
        assertEquals(2, Store.queue(ctx).length())
    }

    @Test fun widgetFrequentChipSavesInOneTap() {
        val tap = Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.PRESET)
            .putExtra("direction", "out").putExtra("amount", 60.0).putExtra("category", "Groceries").putExtra("source", "Cash")
        ActionReceiver().onReceive(ctx, tap)
        waitFor { Store.queue(ctx).length() == 1 }
        val e = Store.queue(ctx).getJSONObject(0)
        assertEquals("Groceries", e.getString("category")); assertEquals(60.0, e.getDouble("amount"), 0.0)
    }

    @Test fun unpairedQuickAddOpensPairing() {
        Store.unpair(ctx)
        val act = Robolectric.buildActivity(QuickAddActivity::class.java).setup().get()
        assertEquals(PairActivity::class.java.name, shadowOf(act).nextStartedActivity.component!!.className)
    }

    @Test fun pairScreen() {
        Store.unpair(ctx)
        val act = Robolectric.buildActivity(PairActivity::class.java).setup().get()
        assertNotNull(find(act.window.decorView, "Pair with eChopdo"))
        shot(act.window.decorView, "4-pair")
        Store.savePairing(ctx, "t", "Home"); Store.saveConfig(ctx, JSONObject(CONFIG))
        val paired = Robolectric.buildActivity(PairActivity::class.java).setup().get()
        assertNotNull(find(paired.window.decorView, "Paired with Home"))
        shot(paired.window.decorView, "5-paired")
    }
}
