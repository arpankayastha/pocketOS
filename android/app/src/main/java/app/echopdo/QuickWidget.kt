package app.echopdo

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

// Home-screen widgets (icons only): − / + open the quick-add sheet. The large one also shows
// the household's frequent Hisab entries as one-tap icon chips (Undo in a notification) and,
// when tall enough, payments read from bank SMS with a one-tap ✓. The small one is just − / +
// with a badge counting payments waiting to be added.
open class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { mgr.updateAppWidget(it, views(ctx, mgr.getAppWidgetOptions(it))) }
        if (Store.paired(ctx)) Thread { runCatching { Api.refreshConfig(ctx) } }.start()
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, options: Bundle) {
        mgr.updateAppWidget(id, views(ctx, options))
    }

    open fun views(ctx: Context, options: Bundle?): RemoteViews = large(ctx, options)

    companion object {
        private val CHIPS = intArrayOf(R.id.p0, R.id.p1, R.id.p2)
        private val CAPS = listOf(Triple(R.id.c0, R.id.c0t, R.id.c0a), Triple(R.id.c1, R.id.c1t, R.id.c1a))

        fun refreshAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            mgr.getAppWidgetIds(ComponentName(ctx, QuickWidget::class.java)).forEach { mgr.updateAppWidget(it, large(ctx, mgr.getAppWidgetOptions(it))) }
            mgr.getAppWidgetIds(ComponentName(ctx, QuickWidgetSmall::class.java)).forEach { mgr.updateAppWidget(it, small(ctx)) }
        }

        private fun activity(ctx: Context, req: Int, intent: Intent) =
            PendingIntent.getActivity(ctx, req, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        fun quickIntent(ctx: Context, direction: String) = Intent(ctx, QuickAddActivity::class.java)
            .setAction("app.echopdo.QUICK.$direction").putExtra("direction", direction)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

        private fun pairIntent(ctx: Context) = Intent(ctx, PairActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        private fun pending(ctx: Context) = Store.config(ctx)?.optJSONArray("pending")

        // Short amount for a chip: 60, 1.2K, 3.5L
        fun short(v: Double): String = when {
            v >= 100_000 -> "%.1fL".format(v / 100_000).replace(".0L", "L")
            v >= 10_000 -> "%.0fK".format(v / 1000)
            v >= 1000 -> "%.1fK".format(v / 1000).replace(".0K", "K")
            v == Math.floor(v) -> v.toLong().toString()
            else -> "%.2f".format(v)
        }

        fun large(ctx: Context, options: Bundle? = null): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
            v.setOnClickPendingIntent(R.id.wHeader, activity(ctx, 1, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
            if (!Store.paired(ctx)) {
                v.setTextViewText(R.id.wTitle, "eChopdo")
                v.setViewVisibility(R.id.wButtons, View.GONE)
                v.setViewVisibility(R.id.wCaps, View.GONE)
                v.setViewVisibility(R.id.wPair, View.VISIBLE)
                v.setOnClickPendingIntent(R.id.wPair, activity(ctx, 2, pairIntent(ctx)))
                return v
            }
            val budget = Store.defaultTarget(ctx) == "budget"
            v.setTextViewText(R.id.wTitle, listOf(Store.household(ctx), if (budget) "Budget" else "Hisab").filter { it.isNotEmpty() }.joinToString(" · "))
            v.setViewVisibility(R.id.wPair, View.GONE)
            v.setViewVisibility(R.id.wButtons, View.VISIBLE)
            v.setOnClickPendingIntent(R.id.wOut, activity(ctx, 3, quickIntent(ctx, "out")))
            v.setOnClickPendingIntent(R.id.wIn, activity(ctx, 4, quickIntent(ctx, "in")))

            // Frequent Hisab entries: icon + amount, one tap saves.
            val frequent = if (budget) null else Store.config(ctx)?.optJSONArray("frequent")
            val n = minOf(frequent?.length() ?: 0, CHIPS.size)
            v.setViewVisibility(R.id.wPresets, if (n > 0) View.VISIBLE else View.GONE)
            CHIPS.forEachIndexed { i, id ->
                if (i >= n) { v.setViewVisibility(id, View.GONE); return@forEachIndexed }
                val f = frequent!!.getJSONObject(i)
                val sign = if (f.optString("direction") == "in") "+" else ""
                v.setViewVisibility(id, View.VISIBLE)
                v.setTextViewText(id, "${f.optString("icon")} $sign${short(f.optDouble("amount"))}")
                v.setContentDescription(id, "${f.optString("category")} ${Calc.money(f.optDouble("amount"))}")
                val tap = Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.PRESET)
                    .putExtra("direction", f.optString("direction", "out")).putExtra("amount", f.optDouble("amount"))
                    .putExtra("category", f.optString("category")).putExtra("source", f.optString("source"))
                v.setOnClickPendingIntent(id, PendingIntent.getBroadcast(ctx, 10 + i, tap, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }

            // Payments read from bank SMS, waiting to be added.
            val caps = pending(ctx)
            val count = caps?.length() ?: 0
            v.setViewVisibility(R.id.wBadge, if (count > 0) View.VISIBLE else View.GONE)
            v.setTextViewText(R.id.wBadge, "$count to add")
            if (count > 0) v.setOnClickPendingIntent(R.id.wBadge, activity(ctx, 5, Captures.chooseIntent(ctx, caps!!.getJSONObject(0))))
            val tall = (options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 0) >= 120
            v.setViewVisibility(R.id.wCaps, if (tall && count > 0) View.VISIBLE else View.GONE)
            CAPS.forEachIndexed { i, (row, text, act) ->
                if (!tall || i >= count) { v.setViewVisibility(row, View.GONE); return@forEachIndexed }
                val c = caps!!.getJSONObject(i)
                v.setViewVisibility(row, View.VISIBLE)
                v.setTextViewText(text, capLine(c))
                v.setOnClickPendingIntent(row, activity(ctx, 20 + i, Captures.chooseIntent(ctx, c)))
                val sug = c.optJSONObject("suggestion")
                if (sug != null) {
                    val icon = sug.optString("icon").takeIf { it.isNotEmpty() && it != "null" }
                    v.setTextViewText(act, "✓ ${icon ?: sug.optString("label")}")
                    v.setOnClickPendingIntent(act, Captures.actionIntent(ctx, ActionReceiver.CAP_FILE, c, 30 + i))
                } else {
                    v.setTextViewText(act, "Add")
                    v.setOnClickPendingIntent(act, activity(ctx, 40 + i, Captures.chooseIntent(ctx, c)))
                }
            }
            return v
        }

        fun capLine(c: JSONObject): String {
            val sign = if (c.optString("direction") == "in") "+" else "−"
            val who = c.optString("payee").takeIf { it.isNotEmpty() && it != "null" } ?: c.optString("bank")
            return "$sign${Calc.money(c.optDouble("amount"))}  $who"
        }

        fun small(ctx: Context): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_small)
            if (!Store.paired(ctx)) {
                v.setOnClickPendingIntent(R.id.sOut, activity(ctx, 50, pairIntent(ctx)))
                v.setOnClickPendingIntent(R.id.sIn, activity(ctx, 51, pairIntent(ctx)))
                v.setViewVisibility(R.id.sBadge, View.GONE)
                return v
            }
            v.setOnClickPendingIntent(R.id.sOut, activity(ctx, 52, quickIntent(ctx, "out")))
            v.setOnClickPendingIntent(R.id.sIn, activity(ctx, 53, quickIntent(ctx, "in")))
            val caps = pending(ctx)
            val count = caps?.length() ?: 0
            v.setViewVisibility(R.id.sBadge, if (count > 0) View.VISIBLE else View.GONE)
            v.setTextViewText(R.id.sBadge, count.toString())
            if (count > 0) v.setOnClickPendingIntent(R.id.sBadge, activity(ctx, 54, Captures.chooseIntent(ctx, caps!!.getJSONObject(0))))
            return v
        }

        // Kept for callers/tests that just want the large layout.
        fun views(ctx: Context): RemoteViews = large(ctx)
    }
}

class QuickWidgetSmall : QuickWidget() {
    override fun views(ctx: Context, options: Bundle?): RemoteViews = small(ctx)
}
