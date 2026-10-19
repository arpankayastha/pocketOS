package app.grandxgamer

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import org.json.JSONObject
import java.io.IOException
import java.time.Instant

// The bank's "money received" SMS on the café's phone → the shop. The SMS is read and parsed here; only the
// amount, time, UPI ref, payer, bank and last digits are sent (bank-sms Edge Function), which matches it to an
// online booking / event advance / tournament fee or a session paid online. Money going out, OTPs, offers and
// card bills are only logged on this phone.
object Captures {
    private const val CHANNEL = "payments"

    fun smsPermitted(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    fun active(ctx: Context) = Store.paired(ctx) && Store.smsEnabled(ctx) && smsPermitted(ctx)

    fun body(t: BankTxn, smsTime: Long): JSONObject = JSONObject().put("action", "capture")
        .put("amount", t.amount).put("at", Instant.ofEpochMilli(smsTime).toString())
        .put("ref", t.ref).put("payer", t.payee).put("bank", t.bank).put("account_hint", t.accountHint)

    var lastError: String? = null

    /** Blocking. Sends one money-received SMS; shows the notification. Returns false if it wasn't sent. */
    fun handle(ctx: Context, sender: String?, text: String, smsTime: Long, notify: Boolean = true): Boolean {
        // Personal SMS (a phone number) are never looked at, nor logged.
        if (!SmsParser.fromBank(sender)) return false
        val d = SmsParser.decide(sender, text)
        val log = { outcome: String, detail: String -> runCatching { Store.logSms(ctx, smsTime, sender, text, outcome, detail) } }
        val t = d.txn ?: run {
            log(if (d.reason.contains("OTP", true) || d.reason.contains("password", true) || d.reason.contains("verification", true)) "otp" else d.outcome, d.reason)
            return false
        }
        if (t.direction != "in") { log("skipped", "Money out · ${Calc.money(t.amount)} — the shop only needs money received"); return false }
        val what = "Money in · ${Calc.money(t.amount)}${t.payee?.let { " from $it" } ?: ""}"
        // Key without "|" (the list separator): the reference, else a hash of sender + text.
        if (!Store.markSeen(ctx, t.ref ?: "h" + Integer.toHexString("$sender $text".hashCode()))) { log("sent", "$what · already sent"); return false }
        val req = body(t, smsTime)
        try {
            val res = Api.call(ctx, JSONObject(req.toString()))
            val match = res.optJSONObject("match")
            if (notify && !res.optBoolean("duplicate")) show(ctx, t, match)
            log("sent", what + when {
                res.optBoolean("duplicate") -> " · already in the shop"
                match != null -> " · ✓ ${match.optString("label")}"
                else -> " · not matched yet (Cash → UPI received)"
            })
        } catch (e: IOException) {
            Store.enqueue(ctx, req); SyncWorker.schedule(ctx); lastError = "offline — queued"
            log("sent", "$what · offline, will send later")
        } catch (e: ApiError) {
            lastError = e.message
            log("error", "$what · ${e.message}")
        }
        if (notify) Store.setSmsStatus(ctx, "Last payment read ${java.time.LocalTime.now().withNano(0).withSecond(0)} · ${Calc.money(t.amount)} ${t.bank}")
        return true
    }

    /** Blocking. Reads bank SMS from the last [days] days. Returns a one-line summary (also kept as the status). */
    fun scanInbox(ctx: Context, days: Int): String {
        if (ctx.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return "SMS reading isn't allowed yet".also { Store.setSmsStatus(ctx, it) }
        val since = System.currentTimeMillis() - days * 86_400_000L
        var total = 0; var fromBanks = 0; var received = 0; var sent = 0
        lastError = null
        ctx.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} >= ?", arrayOf(since.toString()), "${Telephony.Sms.DATE} ASC")?.use { c ->
            while (c.moveToNext()) {
                total++
                val sender = c.getString(0); val text = c.getString(1) ?: ""
                if (!SmsParser.fromBank(sender)) continue
                fromBanks++
                if (SmsParser.decide(sender, text).txn?.direction == "in") received++
                if (handle(ctx, sender, text, c.getLong(2), notify = false)) sent++
            }
        }
        val summary = "Looked back $days days: $total SMS, $fromBanks from banks, $received money received" +
            (if (sent < received) ", ${received - sent} already sent" else "") + (lastError?.let { " · $it" } ?: "")
        Store.setSmsStatus(ctx, summary)
        return summary
    }

    // ----- Notification: "₹160 received from RAHUL K · ✓ PC3 · Test" -----
    private fun manager(ctx: Context): NotificationManager? {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return null
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Payments received", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Money received in the bank, and what it was matched to"
            })
        }
        return nm
    }

    fun title(t: BankTxn) = "${Calc.money(t.amount)} received${t.payee?.let { " from $it" } ?: ""}"
    fun text(match: JSONObject?) = if (match != null) "✓ ${match.optString("label")}" else "Not matched yet — link it in Cash → UPI received"

    private fun show(ctx: Context, t: BankTxn, match: JSONObject?) {
        val nm = manager(ctx) ?: return
        val open = Intent(ctx, MainActivity::class.java).setData(Uri.parse("${BuildConfig.WEB_URL}/#/shop/cash")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val id = 20_000 + ((t.ref ?: "${t.amount}${t.payee}").hashCode() and 0xFFFF)
        nm.notify(id, Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat).setColor(C.accent2)
            .setAutoCancel(true).setContentTitle(title(t)).setContentText(text(match)).setSubText(t.bank)
            .setContentIntent(PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build())
    }
}

// New SMS. Android wakes the app only for this; nothing runs in the background otherwise.
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION || !Captures.active(ctx)) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        // A long SMS arrives in parts: join them per sender.
        val bySender = msgs.groupBy { it.originatingAddress }
        val pending = goAsync()
        val app = ctx.applicationContext
        Thread {
            try {
                for ((sender, parts) in bySender) {
                    val text = parts.joinToString("") { it.messageBody ?: "" }
                    runCatching { Captures.handle(app, sender, text, parts.first().timestampMillis) }
                }
            } finally { pending.finish() }
        }.start()
    }
}
