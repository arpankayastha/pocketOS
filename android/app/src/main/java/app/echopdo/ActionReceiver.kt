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
