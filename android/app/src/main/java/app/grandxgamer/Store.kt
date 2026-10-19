package app.grandxgamer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Everything the phone keeps: the device token (it can only send payments read from bank SMS), the shop's
// name, and payments waiting for a network.
object Store {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("gx", Context.MODE_PRIVATE)

    fun token(ctx: Context): String? = prefs(ctx).getString("token", null)
    fun shop(ctx: Context): String = prefs(ctx).getString("shop", "") ?: ""
    fun paired(ctx: Context) = token(ctx) != null

    fun savePairing(ctx: Context, token: String, shop: String) {
        prefs(ctx).edit().putString("token", token).putString("shop", shop).apply()
    }
    fun setShop(ctx: Context, shop: String) { prefs(ctx).edit().putString("shop", shop).apply() }

    fun unpair(ctx: Context) {
        prefs(ctx).edit().remove("token").remove("shop").remove("queue").apply()
    }

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

    // ----- SMS log (on this phone only, never uploaded) -----
    // The last 300 bank / service SMS and what the app did with each, so a missed payment can be
    // explained (and copied to report it). OTP texts are never kept.
    private fun logPrefs(ctx: Context) = ctx.getSharedPreferences("gx_smslog", Context.MODE_PRIVATE)
    @Synchronized fun smsLog(ctx: Context): JSONArray =
        logPrefs(ctx).getString("log", null)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
    @Synchronized fun logSms(ctx: Context, at: Long, sender: String?, text: String, outcome: String, detail: String) {
        val key = "${sender.orEmpty()}|$at|${text.hashCode()}"
        val old = smsLog(ctx)
        val next = JSONArray()
        next.put(JSONObject().put("key", key).put("at", at).put("sender", sender.orEmpty()).put("outcome", outcome).put("detail", detail)
            .put("text", if (outcome == "otp") "" else text.take(600)))
        // Newest first; one row per SMS (a look-back re-reads the same SMS: keep the latest outcome).
        for (i in 0 until old.length()) { val r = old.getJSONObject(i); if (r.optString("key") != key && next.length() < 300) next.put(r) }
        // Keep it sorted by SMS time, newest first.
        val rows = (0 until next.length()).map { next.getJSONObject(it) }.sortedByDescending { it.optLong("at") }
        logPrefs(ctx).edit().putString("log", JSONArray(rows).toString()).apply()
    }
    fun clearSmsLog(ctx: Context) { logPrefs(ctx).edit().remove("log").apply() }

    /** Forget which SMS were sent (for "Resync"; the server still refuses real duplicates). */
    fun clearSeen(ctx: Context) { prefs(ctx).edit().remove("seen").apply() }

    /** Remembers the last few hundred SMS already sent, so a re-scan doesn't send them again. */
    @Synchronized fun markSeen(ctx: Context, key: String): Boolean {
        val seen = prefs(ctx).getString("seen", "").orEmpty().split('|').filter { it.isNotEmpty() }
        if (key in seen) return false
        prefs(ctx).edit().putString("seen", (seen + key).takeLast(1500).joinToString("|")).apply()
        return true
    }

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
