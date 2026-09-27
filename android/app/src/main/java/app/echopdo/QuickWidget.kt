package app.echopdo

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

// Home-screen widget: Spent / Received open the quick-add sheet; the chips below are the
// household's frequent Hisab entries and save in one tap (with Undo in a notification).
class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        ids.forEach { mgr.updateAppWidget(it, views(ctx)) }
        if (Store.paired(ctx)) Thread { runCatching { Api.refreshConfig(ctx) } }.start()
    }

    companion object {
        private val CHIPS = intArrayOf(R.id.p0, R.id.p1, R.id.p2, R.id.p3)

        fun refreshAll(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, QuickWidget::class.java))
            if (ids.isNotEmpty()) mgr.updateAppWidget(ids, views(ctx))
        }

        private fun activity(ctx: Context, req: Int, intent: Intent) =
            PendingIntent.getActivity(ctx, req, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        fun quickIntent(ctx: Context, direction: String) = Intent(ctx, QuickAddActivity::class.java)
            .setAction("app.echopdo.QUICK.$direction").putExtra("direction", direction)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

        fun views(ctx: Context): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
            v.setOnClickPendingIntent(R.id.wTitle, activity(ctx, 1, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
            if (!Store.paired(ctx)) {
                v.setTextViewText(R.id.wTitle, "eChopdo")
                v.setViewVisibility(R.id.wButtons, View.GONE)
                v.setViewVisibility(R.id.wPresets, View.GONE)
                v.setViewVisibility(R.id.wPair, View.VISIBLE)
                v.setOnClickPendingIntent(R.id.wPair, activity(ctx, 2, Intent(ctx, PairActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
                return v
            }
            val budget = Store.defaultTarget(ctx) == "budget"
            val hh = Store.household(ctx)
            v.setTextViewText(R.id.wTitle, listOf("eChopdo", hh, if (budget) "Budget" else "Hisab").filter { it.isNotEmpty() }.joinToString(" · "))
            v.setViewVisibility(R.id.wPair, View.GONE)
            v.setViewVisibility(R.id.wButtons, View.VISIBLE)
            v.setTextViewText(R.id.wOut, if (budget) "−  Expense" else "−  Spent")
            v.setTextViewText(R.id.wIn, if (budget) "+  Income" else "+  Received")
            v.setOnClickPendingIntent(R.id.wOut, activity(ctx, 3, quickIntent(ctx, "out")))
            v.setOnClickPendingIntent(R.id.wIn, activity(ctx, 4, quickIntent(ctx, "in")))

            val frequent = if (budget) null else Store.config(ctx)?.optJSONArray("frequent")
            val n = minOf(frequent?.length() ?: 0, CHIPS.size)
            v.setViewVisibility(R.id.wPresets, if (n > 0) View.VISIBLE else View.GONE)
            CHIPS.forEachIndexed { i, id ->
                if (i >= n) { v.setViewVisibility(id, View.GONE); return@forEachIndexed }
                val f = frequent!!.getJSONObject(i)
                val sign = if (f.optString("direction") == "in") "+" else ""
                v.setViewVisibility(id, View.VISIBLE)
                v.setTextViewText(id, "${f.optString("icon")} ${f.optString("category")} $sign${Calc.money(f.optDouble("amount"))}")
                val tap = Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.PRESET)
                    .putExtra("direction", f.optString("direction", "out")).putExtra("amount", f.optDouble("amount"))
                    .putExtra("category", f.optString("category")).putExtra("source", f.optString("source"))
                v.setOnClickPendingIntent(id, PendingIntent.getBroadcast(ctx, 10 + i, tap, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            return v
        }
    }
}
