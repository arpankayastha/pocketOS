package app.echopdo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Bank SMS → "To add" list. The SMS is read and parsed here on the phone; only the parsed
// fields (amount, direction, date, last digits, payee, UPI ref, bank) are sent to eChopdo.
object Captures {
    private const val CHANNEL = "captures"

    fun smsPermitted(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    fun active(ctx: Context) = Store.paired(ctx) && Store.smsEnabled(ctx) && smsPermitted(ctx)

    fun body(t: BankTxn, smsTime: Long): JSONObject = JSONObject().put("action", "capture")
        .put("direction", t.direction).put("amount", t.amount)
        .put("date", (t.date ?: Instant.ofEpochMilli(smsTime).atZone(ZoneId.systemDefault()).toLocalDate()).toString())
        .put("account_hint", t.accountHint).put("card", t.card).put("payee", t.payee).put("ref", t.ref).put("bank", t.bank)

    /** Blocking. Sends one parsed SMS; shows the notification. Returns false if it was already sent. */
    var lastError: String? = null

    fun handle(ctx: Context, sender: String?, text: String, smsTime: Long, notify: Boolean = true, refresh: Boolean = true): Boolean {
        if (!SmsParser.fromBank(sender)) return false
        val t = SmsParser.parse(sender, text) ?: return false
        // Key without "|" (the list separator): a reference, else a hash of sender + text.
        if (!Store.markSeen(ctx, t.ref ?: "h" + Integer.toHexString("$sender $text".hashCode()))) return false
        val req = body(t, smsTime)
        try {
            val res = Api.call(ctx, JSONObject(req.toString()))
            if (notify && !res.optBoolean("duplicate")) show(ctx, res)
        } catch (e: IOException) {
            Store.enqueue(ctx, req); SyncWorker.schedule(ctx); lastError = "offline — queued"
        } catch (e: ApiError) {
            lastError = e.message
            if (e.unpaired) QuickWidget.refreshAll(ctx)
        }
        if (refresh) runCatching { Api.refreshConfig(ctx) }
        if (notify) Store.setSmsStatus(ctx, "Last payment read ${java.time.LocalTime.now().withNano(0).withSecond(0)} · ${Calc.money(t.amount)} ${t.bank}")
        return true
    }

    /** Blocking. Reads bank SMS from the last [days] days (after turning capture on). */
    /** Blocking. Reads bank SMS from the last [days] days. Returns a one-line summary (also kept as the status). */
    fun scanInbox(ctx: Context, days: Int): String {
        if (ctx.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return "SMS reading isn't allowed yet".also { Store.setSmsStatus(ctx, it) }
        val since = System.currentTimeMillis() - days * 86_400_000L
        var total = 0; var fromBanks = 0; var payments = 0; var sent = 0
        lastError = null
        ctx.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} >= ?", arrayOf(since.toString()), "${Telephony.Sms.DATE} ASC")?.use { c ->
            while (c.moveToNext()) {
                total++
                val sender = c.getString(0); val text = c.getString(1) ?: ""
                if (!SmsParser.fromBank(sender)) continue
                fromBanks++
                if (SmsParser.parse(sender, text) != null) payments++
                if (handle(ctx, sender, text, c.getLong(2), notify = false, refresh = false)) sent++
            }
        }
        runCatching { Api.refreshConfig(ctx) }
        val summary = "Looked back $days days: $total SMS, $fromBanks from banks/services, $payments payments" +
            (if (sent < payments) ", ${payments - sent} already sent" else "") + (lastError?.let { " · $it" } ?: "")
        Store.setSmsStatus(ctx, summary)
        return summary
    }

    // ----- Notification with one-tap actions -----
    private fun manager(ctx: Context): NotificationManager? {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return null
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bank payments", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "A payment read from a bank SMS, to add to Hisab or Budget in one tap"
            })
        }
        return nm
    }

    fun title(c: JSONObject): String {
        val who = c.optString("payee").ifEmpty { "UPI" }
        return "${Calc.money(c.optDouble("amount"))} ${if (c.optString("direction") == "in") "from" else "to"} $who"
    }

    fun subtitle(c: JSONObject): String {
        val date = runCatching { LocalDate.parse(c.optString("date")).format(DateTimeFormatter.ofPattern("d MMM")) }.getOrDefault("")
        val acct = c.optString("account_hint").takeIf { it.isNotEmpty() }?.let { (if (c.optBoolean("card")) "card ·" else "·") + it }
        return listOfNotNull(c.optString("bank").ifEmpty { null }, acct, date.ifEmpty { null }).joinToString(" ")
    }

    fun nid(c: JSONObject) = 20_000 + (c.optString("id").hashCode() and 0xFFFF)

    fun chooseIntent(ctx: Context, c: JSONObject) = Intent(ctx, QuickAddActivity::class.java)
        .setAction("app.echopdo.CAPTURE.${c.optString("id")}").putExtra("capture", c.toString())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

    fun actionIntent(ctx: Context, action: String, c: JSONObject, req: Int): PendingIntent {
        val i = Intent(ctx, ActionReceiver::class.java).setAction(action)
            .putExtra("capture", c.toString()).putExtra("nid", nid(c))
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun show(ctx: Context, c: JSONObject) {
        val nm = manager(ctx) ?: return
        val id = nid(c)
        val choose = PendingIntent.getActivity(ctx, id, chooseIntent(ctx, c), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat).setColor(0xFF60A5FA.toInt())
            .setAutoCancel(true).setContentIntent(choose).setSubText(subtitle(c))
        val filed = c.optJSONObject("filed")
        val sug = c.optJSONObject("suggestion") ?: c.optJSONObject("guess")
        val icon = c.optString("icon").takeIf { it.isNotEmpty() && it != "null" }?.let { "$it " } ?: ""
        val label = c.optString("label").takeIf { it.isNotEmpty() && it != "null" }
        val where = if (filed?.optString("target") == "budget") "Budget" else "Hisab"
        when {
            filed != null && !filed.has("already") -> {
                // Added automatically: Change… reopens it in the sheet, Remove takes it out.
                b.setContentTitle("Added ${title(c)}").setContentText("$icon${label ?: where} · $where")
                    .setContentIntent(PendingIntent.getActivity(ctx, id, chooseIntent(ctx, c.put("refile", true)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                    .addAction(Notification.Action.Builder(null, "Change…", PendingIntent.getActivity(ctx, id + 5, chooseIntent(ctx, c.put("refile", true)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build())
                    .addAction(Notification.Action.Builder(null, "Remove", actionIntent(ctx, ActionReceiver.CAP_UNFILE, c, id + 6)).build())
            }
            c.optBoolean("matched") -> {
                b.setContentTitle(title(c)).setContentText("Already added by you — not added again")
                    .addAction(Notification.Action.Builder(null, "Add anyway", PendingIntent.getActivity(ctx, id + 7, chooseIntent(ctx, c.put("refile", true)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build())
            }
            else -> {
                b.setContentTitle(title(c)).setContentText(if (sug != null) "Tap ✓ to add it as ${sug.optString("label")}" else "Tap to add it to eChopdo")
                if (sug != null) b.addAction(Notification.Action.Builder(null, "✓ ${sug.optString("icon").let { if (it.isEmpty() || it == "null") "" else "$it " }}${sug.optString("label")}", actionIntent(ctx, ActionReceiver.CAP_FILE, c, id + 3)).build())
                b.addAction(Notification.Action.Builder(null, if (sug != null) "Change…" else "Add…", choose).build())
                b.addAction(Notification.Action.Builder(null, "Ignore", actionIntent(ctx, ActionReceiver.CAP_IGNORE, c, id + 4)).build())
            }
        }
        nm.notify(id, b.build())
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
