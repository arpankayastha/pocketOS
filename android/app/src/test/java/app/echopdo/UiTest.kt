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
{"device":{"name":"Test phone","default_target":"hisab"},"household":{"name":"Home","color":null},
 "hisab":{"books":[{"id":"b1","name":"Daily","kind":"daily"},{"id":"b2","name":"Diwali","kind":"occasion"}],
  "out":[{"name":"Groceries","icon":"🥦"},{"name":"Food","icon":"🍽️"},{"name":"Fuel","icon":"⛽"},{"name":"Medical","icon":"💊"},{"name":"Other","icon":"📦"}],
  "in":[{"name":"Shagun","icon":"🧧"},{"name":"Refund","icon":"↩️"}],"sources":["Cash","UPI","Card"]},
 "budget":{"expense":[{"id":"c1","name":"Bills","color":"#3987e5"},{"id":"c2","name":"Shopping","color":"#d95926"}],
  "income":[{"id":"c3","name":"Salary","color":"#34d399"}],"accounts":[{"id":"a1","name":"Cash","color":"#8b93a5"}]},
 "frequent":[{"direction":"out","amount":60,"category":"Groceries","source":"Cash","icon":"🥦","n":5},
  {"direction":"out","amount":500,"category":"Fuel","source":"UPI","icon":"⛽","n":3}],"today":"2026-09-28"}
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

    @Test fun widgetShowsButtonsAndFrequent() {
        val host = FrameLayout(ctx)
        val v = QuickWidget.views(ctx).apply(ctx, host)
        host.addView(v, FrameLayout.LayoutParams(ctx.dp(340), ctx.dp(150)))
        host.measure(View.MeasureSpec.makeMeasureSpec(ctx.dp(340), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(ctx.dp(150), View.MeasureSpec.EXACTLY))
        host.layout(0, 0, ctx.dp(340), ctx.dp(150))
        assertNotNull(find(v, "eChopdo · Home · Hisab"))
        assertNotNull(find(v, "−  Spent"))
        assertEquals(View.VISIBLE, v.findViewById<View>(R.id.p0).visibility)
        assertEquals("🥦 Groceries ₹60", v.findViewById<TextView>(R.id.p0).text.toString())
        assertEquals(View.GONE, v.findViewById<View>(R.id.p2).visibility)
        shot(host, "3-widget")

        Store.unpair(ctx)
        val u = QuickWidget.views(ctx).apply(ctx, FrameLayout(ctx))
        assertEquals(View.VISIBLE, u.findViewById<View>(R.id.wPair).visibility)
        assertEquals(View.GONE, u.findViewById<View>(R.id.wButtons).visibility)
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
