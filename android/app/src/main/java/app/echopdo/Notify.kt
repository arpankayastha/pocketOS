package app.echopdo

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.app.Notification
import org.json.JSONObject

object Notify {
    private const val CHANNEL = "saved"

    private fun manager(ctx: Context): NotificationManager? {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return null
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Saved entries", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Confirms entries added from the widget, with Undo"
            })
        }
        return nm
    }

    fun label(entry: JSONObject): String {
        val amount = Calc.money(entry.optDouble("amount"))
        val what = entry.optString("category_name").ifEmpty { entry.optString("category") }.ifEmpty { if (entry.optString("target") == "budget") "Budget" else "Hisab" }
        return "$amount · $what"
    }

    /** "Saved ₹60 · Groceries" with Undo, for one-tap saves from the widget. */
    fun saved(ctx: Context, entry: JSONObject, result: SaveResult) {
        val nm = manager(ctx) ?: return
        val nid = (System.currentTimeMillis() % 100000).toInt()
        val b = Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat).setColor(0xFF60A5FA.toInt())
            .setAutoCancel(true).setTimeoutAfter(15 * 60_000L)
        when (result) {
            is SaveResult.Saved -> {
                val undo = Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.UNDO)
                    .putExtra("id", result.id).putExtra("target", result.target).putExtra("nid", nid)
                val pi = PendingIntent.getBroadcast(ctx, nid, undo, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                b.setContentTitle("Saved ${label(entry)}").setContentText(if (result.target == "budget") "Added to Budget" else "Added to Hisab")
                    .addAction(Notification.Action.Builder(null, "Undo", pi).build())
            }
            is SaveResult.Queued -> b.setContentTitle("Saved ${label(entry)}").setContentText("No internet — it will be sent when you're back online.")
            is SaveResult.Failed -> b.setContentTitle("Not saved: ${label(entry)}").setContentText(result.message)
        }
        nm.notify(nid, b.build())
    }

    fun failed(ctx: Context, entry: JSONObject, message: String) = saved(ctx, entry, SaveResult.Failed(message))

    fun cancel(ctx: Context, nid: Int) { ctx.getSystemService(NotificationManager::class.java).cancel(nid) }
}
