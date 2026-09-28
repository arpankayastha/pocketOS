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

    // ----- Bank SMS capture -----
    // On unless turned off in the app (allowing SMS in Android settings is enough to start).
    fun smsEnabled(ctx: Context) = prefs(ctx).getBoolean("sms", true)
    fun smsStatus(ctx: Context): String? = prefs(ctx).getString("smsStatus", null)
    fun setSmsStatus(ctx: Context, s: String) { prefs(ctx).edit().putString("smsStatus", s).apply() }
    fun setSmsEnabled(ctx: Context, on: Boolean) { prefs(ctx).edit().putBoolean("sms", on).apply() }

    /** Forget which SMS were sent (for "Resync"; the server still refuses real duplicates). */
    fun clearSeen(ctx: Context) { prefs(ctx).edit().remove("seen").apply() }

    /** Remembers the last few hundred SMS already sent, so a re-scan doesn't send them again. */
    @Synchronized fun markSeen(ctx: Context, key: String): Boolean {
        val seen = prefs(ctx).getString("seen", "").orEmpty().split('|').filter { it.isNotEmpty() }
        if (key in seen) return false
        prefs(ctx).edit().putString("seen", (seen + key).takeLast(1500).joinToString("|")).apply()
        return true
    }

    // ----- Occasion book picked in the quick-add sheet (kept 3 hours) -----
    fun recentBook(ctx: Context): String? = prefs(ctx).takeIf { System.currentTimeMillis() - it.getLong("bookAt", 0) < 3 * 3600_000L }?.getString("book", null)
    fun setRecentBook(ctx: Context, id: String?) { prefs(ctx).edit().putString("book", id).putLong("bookAt", System.currentTimeMillis()).apply() }

    // ----- Update check -----
    fun lastUpdateCheck(ctx: Context) = prefs(ctx).getLong("updateCheck", 0)
    fun latestVersion(ctx: Context) = prefs(ctx).getInt("latestVersion", 0)
    fun latestName(ctx: Context) = prefs(ctx).getString("latestName", "").orEmpty()
    fun latestSha(ctx: Context) = prefs(ctx).getString("latestSha", "").orEmpty()
    fun saveUpdateCheck(ctx: Context, latest: Int, name: String = "", sha: String = "") {
        prefs(ctx).edit().putLong("updateCheck", System.currentTimeMillis()).putInt("latestVersion", latest)
            .putString("latestName", name).putString("latestSha", sha.lowercase()).remove("updateError").apply()
    }
    fun updateError(ctx: Context) = prefs(ctx).getString("updateError", null)
    fun setUpdateError(ctx: Context, msg: String) { prefs(ctx).edit().putString("updateError", msg).apply() }
}
