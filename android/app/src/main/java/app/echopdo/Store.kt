package app.echopdo

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Everything the phone keeps: the device token (only adds entries), the last picker config
// from the server, and entries waiting for a network.
object Store {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("echopdo", Context.MODE_PRIVATE)

    fun token(ctx: Context): String? = prefs(ctx).getString("token", null)
    fun household(ctx: Context): String = prefs(ctx).getString("household", "") ?: ""
    fun paired(ctx: Context) = token(ctx) != null

    fun savePairing(ctx: Context, token: String, household: String) {
        prefs(ctx).edit().putString("token", token).putString("household", household).remove("config").apply()
    }

    fun unpair(ctx: Context) {
        prefs(ctx).edit().remove("token").remove("household").remove("config").remove("queue").apply()
    }

    fun config(ctx: Context): JSONObject? =
        prefs(ctx).getString("config", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun saveConfig(ctx: Context, cfg: JSONObject) {
        val hh = cfg.optJSONObject("household")?.optString("name").orEmpty()
        prefs(ctx).edit().putString("config", cfg.toString()).putString("household", hh.ifEmpty { household(ctx) })
            .putLong("configAt", System.currentTimeMillis()).apply()
    }

    fun defaultTarget(ctx: Context): String =
        config(ctx)?.optJSONObject("device")?.optString("default_target")?.takeIf { it.isNotEmpty() } ?: "hisab"

    // ----- Offline queue -----
    @Synchronized fun queue(ctx: Context): JSONArray =
        prefs(ctx).getString("queue", null)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

    @Synchronized fun enqueue(ctx: Context, entry: JSONObject) {
        val q = queue(ctx); q.put(entry)
        prefs(ctx).edit().putString("queue", q.toString()).apply()
    }

    @Synchronized fun setQueue(ctx: Context, q: JSONArray) {
        prefs(ctx).edit().putString("queue", q.toString()).apply()
    }

    // ----- Update check -----
    fun lastUpdateCheck(ctx: Context) = prefs(ctx).getLong("updateCheck", 0)
    fun latestVersion(ctx: Context) = prefs(ctx).getInt("latestVersion", 0)
    fun saveUpdateCheck(ctx: Context, latest: Int) {
        prefs(ctx).edit().putLong("updateCheck", System.currentTimeMillis()).putInt("latestVersion", latest).apply()
    }
}
