package app.echopdo

import android.app.Notification
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit

// GPay / Paytm payment notifications → the payee's real name for the payment the bank SMS already
// (or soon) brings in. The bank SMS stays the record of the payment (it has the account); the
// notification only adds who it was to ("Asha Stores" instead of "9000000001@okbizaxis"), which also
// improves the category guess. A payment with no bank SMS (a wallet payment) is added on its own
// after a wait. Nothing but amount, direction, name, app and time leaves the phone.
object UpiLink {
    const val WINDOW_MS = 15 * 60_000L   // an SMS and a notice this close, same amount + direction, are one payment
    const val SETTLE_MS = 10 * 60_000L   // no bank SMS by then → add the notice on its own

    fun accessGranted(ctx: Context): Boolean {
        val enabled = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        return enabled.split(':').any { it.startsWith(ctx.packageName + "/") }
    }

    fun active(ctx: Context) = Store.paired(ctx) && Store.upiEnabled(ctx) && accessGranted(ctx)

    /** Blocking. One notification posted by GPay / Paytm. */
    fun handle(ctx: Context, pkg: String, title: String?, text: String?, postTime: Long) {
        val app = UpiParser.appFor(pkg) ?: return
        val shown = listOfNotNull(title?.takeIf { it.isNotBlank() }, text?.takeIf { it.isNotBlank() }).joinToString(" · ")
        if (shown.isEmpty()) return
        val n = UpiParser.parse(pkg, title, text)
        if (n == null) { Store.logUpi(ctx, postTime, app, shown, "skip", "Not a completed payment"); return }
        // Apps re-post a notification when it updates: read each once.
        if (!Store.markSeen(ctx, "u" + Integer.toHexString("$pkg $shown ${postTime / 60_000}".hashCode()))) return
        val what = "${if (n.direction == "in") "Money in" else "Money out"} · ${Calc.money(n.amount)}${n.name?.let { " · $it" } ?: ""}"
        val recent = Store.upiRecent(ctx)
        recent.put(JSONObject().put("key", "$postTime|$shown".hashCode()).put("at", postTime).put("direction", n.direction)
            .put("amount", n.amount).put("name", n.name ?: "").put("app", n.app).put("state", "open").put("shown", shown))
        Store.setUpiRecent(ctx, recent)
        // The SMS may already be in eChopdo: if so, give that payment the name now.
        if (n.name != null) {
            try {
                val res = Api.call(ctx, JSONObject().put("action", "enrich").put("direction", n.direction).put("amount", n.amount).put("payee", n.name))
                if (res.optBoolean("enriched")) {
                    setState(ctx, postTime, "named")
                    Store.logUpi(ctx, postTime, app, shown, "sent", "$what · named the bank SMS payment")
                    return
                }
            } catch (_: IOException) { /* offline: the settle job retries */ } catch (_: ApiError) { /* try again at settle time */ }
        }
        Store.logUpi(ctx, postTime, app, shown, "wait", "$what · waiting for its bank SMS")
        UpiSettleWorker.schedule(ctx, SETTLE_MS)
    }

    private fun setState(ctx: Context, at: Long, state: String) {
        val a = Store.upiRecent(ctx)
        for (i in 0 until a.length()) { val r = a.getJSONObject(i); if (r.optLong("at") == at) r.put("state", state) }
        Store.setUpiRecent(ctx, a)
    }

    /** SMS path: the name of a recent, still-open notice for this payment (marks it used), or null. */
    fun nameFor(ctx: Context, direction: String, amount: Double, smsTime: Long): String? {
        if (direction != "in" && direction != "out") return null
        val a = Store.upiRecent(ctx)
        for (i in 0 until a.length()) {
            val r = a.getJSONObject(i)
            if (r.optString("state") != "open" || r.optString("direction") != direction) continue
            if (Math.abs(r.optDouble("amount") - amount) > 0.001 || Math.abs(r.optLong("at") - smsTime) > WINDOW_MS) continue
            r.put("state", "named")
            Store.setUpiRecent(ctx, a)
            runCatching { Store.logUpi(ctx, r.optLong("at"), r.optString("app"), r.optString("shown"), "sent", "${Calc.money(amount)} · its name went on the bank SMS payment") }
            return r.optString("name").takeIf { it.isNotEmpty() }
        }
        return null
    }

    /** Blocking (worker). Notices that waited long enough with no bank SMS are added as payments of their own. Returns true to retry. */
    fun settle(ctx: Context): Boolean {
        if (!Store.paired(ctx)) return false
        val a = Store.upiRecent(ctx)
        var retry = false
        var nextIn = Long.MAX_VALUE
        for (i in 0 until a.length()) {
            val r = a.getJSONObject(i)
            if (r.optString("state") != "open") continue
            val age = System.currentTimeMillis() - r.optLong("at")
            if (age < SETTLE_MS - 30_000) { nextIn = minOf(nextIn, SETTLE_MS - age); continue }
            val at = r.optLong("at")
            val req = JSONObject().put("action", "capture").put("source", "upi")
                .put("direction", r.optString("direction")).put("amount", r.optDouble("amount"))
                .put("date", Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDate().toString())
                .put("at", Instant.ofEpochMilli(at).toString())
                .put("payee", r.optString("name").ifEmpty { null }).put("bank", r.optString("app"))
            try {
                val res = Api.call(ctx, req)
                r.put("state", "sent")
                val how = when {
                    res.optBoolean("duplicate") && res.optBoolean("enriched") -> "named the bank SMS payment"
                    res.optBoolean("duplicate") -> "already in eChopdo"
                    else -> "added (no bank SMS)"
                }
                Store.logUpi(ctx, at, r.optString("app"), r.optString("shown"), "sent", "${Calc.money(r.optDouble("amount"))} · $how")
                if (!res.optBoolean("duplicate")) Captures.show(ctx, res)
            } catch (_: IOException) { retry = true
            } catch (e: ApiError) {
                r.put("state", "sent")
                Store.logUpi(ctx, at, r.optString("app"), r.optString("shown"), "error", e.message ?: "Could not send")
            }
        }
        Store.setUpiRecent(ctx, a)
        if (!retry && nextIn != Long.MAX_VALUE) UpiSettleWorker.schedule(ctx, nextIn + 5_000)
        return retry
    }
}

class UpiSettleWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result = if (runCatching { UpiLink.settle(applicationContext) }.getOrDefault(false)) Result.retry() else Result.success()

    companion object {
        fun schedule(ctx: Context, delayMs: Long) {
            val req = OneTimeWorkRequestBuilder<UpiSettleWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            runCatching { WorkManager.getInstance(ctx).enqueueUniqueWork("upi-settle", ExistingWorkPolicy.REPLACE, req) }
        }
    }
}

// Android hands GPay / Paytm notifications to this once "Notification access" is allowed for eChopdo.
// Only those two apps' notifications are looked at; everything else is ignored unread.
class UpiNotifications : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (UpiParser.appFor(sbn.packageName) == null) return
        val ctx = applicationContext
        if (!Store.paired(ctx) || !Store.upiEnabled(ctx)) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val ex = n.extras
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString()
        val pkg = sbn.packageName
        val at = sbn.postTime
        Thread { runCatching { UpiLink.handle(ctx, pkg, title, text, at) } }.start()
    }
}
