package app.echopdo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONObject
import java.time.LocalDate

// Taps that don't open a screen: a frequent-entry chip on the widget, and Undo.
class ActionReceiver : BroadcastReceiver() {
    companion object {
        const val PRESET = "app.echopdo.PRESET"
        const val UNDO = "app.echopdo.UNDO"
        const val CAP_FILE = "app.echopdo.CAP_FILE"     // file a captured payment with its suggestion
        const val CAP_IGNORE = "app.echopdo.CAP_IGNORE"
        const val CAP_MATCH = "app.echopdo.CAP_MATCH"   // "same as the one I already added"
        const val CAP_UNFILE = "app.echopdo.CAP_UNFILE" // take an automatically added payment out again
        const val CAP_SELF = "app.echopdo.CAP_SELF"     // "My account": a transfer; skip this payee from now on
        const val CAP_UNBILL = "app.echopdo.CAP_UNBILL" // undo "card bill marked paid"
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val pending = goAsync()
        val app = ctx.applicationContext
        Thread {
            try {
                when (intent.action) {
                    PRESET -> {
                        val entry = JSONObject().put("target", "hisab")
                            .put("direction", intent.getStringExtra("direction") ?: "out")
                            .put("amount", intent.getDoubleExtra("amount", 0.0))
                            .put("category", intent.getStringExtra("category"))
                            .put("source", intent.getStringExtra("source")?.takeIf { it.isNotEmpty() })
                            .put("date", LocalDate.now().toString())
                        val res = Repo.save(app, entry)
                        toast(app, when (res) {
                            is SaveResult.Saved -> "Saved ${Notify.label(entry)}"
                            is SaveResult.Queued -> "Saved offline: ${Notify.label(entry)}"
                            is SaveResult.Failed -> res.message
                        })
                        Notify.saved(app, entry, res)
                        if (res is SaveResult.Failed && res.unpaired) QuickWidget.refreshAll(app)
                    }
                    CAP_UNBILL -> {
                        Notify.cancel(app, intent.getIntExtra("nid", 0))
                        val c = JSONObject(intent.getStringExtra("capture") ?: "{}")
                        val msg = try { Api.call(app, JSONObject().put("action", "unbill").put("id", c.optString("id"))); "Bill no longer marked paid" }
                            catch (e: ApiError) { e.message ?: "Could not undo." } catch (e: java.io.IOException) { "No internet — undo it in eChopdo → Plan." }
                        toast(app, msg)
                    }
                    CAP_FILE, CAP_IGNORE, CAP_MATCH, CAP_UNFILE, CAP_SELF -> {
                        Notify.cancel(app, intent.getIntExtra("nid", 0))
                        val c = JSONObject(intent.getStringExtra("capture") ?: "{}")
                        val body = JSONObject().put("capture_id", c.optString("id"))
                        when (intent.action) {
                            CAP_FILE -> {
                                val sug = c.optJSONObject("suggestion") ?: c.optJSONObject("guess") ?: JSONObject()
                                body.put("action", "file")
                                listOf("target", "category", "category_id", "account_id", "source", "book_id").forEach { k ->
                                    sug.optString(k).takeIf { it.isNotEmpty() && it != "null" }?.let { body.put(k, it) }
                                }
                            }
                            CAP_IGNORE -> body.put("action", "ignore")
                            CAP_UNFILE -> body.put("action", "unfile")
                            CAP_SELF -> body.put("action", "self")
                            else -> body.put("action", "match")
                        }
                        val msg = try {
                            val res = Api.call(app, body)
                            when (intent.action) {
                                CAP_FILE -> if (res.has("already")) "Already done" else "Added ${Calc.money(c.optDouble("amount"))} · ${(c.optJSONObject("suggestion") ?: c.optJSONObject("guess"))?.optString("label") ?: ""}"
                                CAP_IGNORE -> "Ignored"
                                CAP_UNFILE -> "Removed"
                                CAP_SELF -> "Marked as your own account — it won't be added again"
                                else -> "Marked as already added"
                            }
                        } catch (e: ApiError) { e.message ?: "Could not save." } catch (e: java.io.IOException) { "No internet — open eChopdo to add it later." }
                        toast(app, msg)
                        runCatching { Api.refreshConfig(app) }
                    }
                    UNDO -> {
                        Notify.cancel(app, intent.getIntExtra("nid", 0))
                        val err = Repo.undo(app, intent.getStringExtra("target") ?: "hisab", intent.getStringExtra("id") ?: "")
                        toast(app, err ?: "Removed")
                    }
                }
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun toast(ctx: Context, text: String) =
        Handler(Looper.getMainLooper()).post { Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show() }
}
