package app.echopdo

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.io.File

// Runs right after an update: Android keeps showing a widget's old layout until the app redraws it,
// and the app has closed for the install, so a notification opens it again.
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        QuickWidget.refreshAll(ctx)
        File(ctx.cacheDir, "update.apk").delete()
        Updates.schedule(ctx)
        Updates.notify(ctx, "eChopdo updated to ${BuildConfig.VERSION_NAME}", "Tap to open",
            PendingIntent.getActivity(ctx, 30_003, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE))
        if (Store.paired(ctx)) {
            val pending = goAsync()
            Thread { try { runCatching { Api.refreshConfig(ctx) } } finally { pending.finish() } }.start()
        }
    }
}
