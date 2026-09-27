package app.echopdo

import android.app.Application
import android.content.Context
import android.os.Build

// Keeps the last crash so the start screen can show it (Android often closes silently on the
// first crash, which looks like "nothing happens").
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runCatching { Crash.save(this, e) }
            previous?.uncaughtException(t, e)
        }
    }
}

object Crash {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("crash", Context.MODE_PRIVATE)

    fun save(ctx: Context, e: Throwable) {
        val report = "eChopdo ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · Android ${Build.VERSION.RELEASE} · ${Build.MODEL}\n" +
            java.util.Date().toString() + "\n" + e.stackTraceToString().take(4000)
        prefs(ctx).edit().putString("last", report).commit()
    }

    fun last(ctx: Context): String? = prefs(ctx).getString("last", null)
    fun clear(ctx: Context) { prefs(ctx).edit().remove("last").apply() }
}
