package app.echopdo

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// The app isn't in the Play Store: once a day it checks the download page for a newer build.
object Updates {
    const val PAGE = "${BuildConfig.WEB_URL}/download/"

    fun available(ctx: Context) = Store.latestVersion(ctx) > BuildConfig.VERSION_CODE

    /** Blocking; returns true when a newer version exists. */
    fun check(ctx: Context, force: Boolean = false): Boolean {
        if (!force && System.currentTimeMillis() - Store.lastUpdateCheck(ctx) < 24 * 3600_000L) return available(ctx)
        runCatching {
            val conn = URL("${PAGE}version.json").openConnection() as HttpURLConnection
            conn.connectTimeout = 8000; conn.readTimeout = 8000
            conn.setRequestProperty("Cache-Control", "no-cache")
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            conn.disconnect()
            Store.saveUpdateCheck(ctx, json.optInt("versionCode"))
        }
        return available(ctx)
    }
}
