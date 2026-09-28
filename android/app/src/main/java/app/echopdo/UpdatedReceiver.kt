package app.echopdo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Android keeps showing a widget's old layout after an app update until the app redraws it.
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        QuickWidget.refreshAll(ctx)
        if (Store.paired(ctx)) {
            val pending = goAsync()
            Thread { try { runCatching { Api.refreshConfig(ctx) } } finally { pending.finish() } }.start()
        }
    }
}
