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

    // ----- SMS / UPI logs (on this phone only, never uploaded) -----
    // The last 300 bank / service SMS (and GPay / Paytm notifications) and what eChopdo did with each, so a
    // missed payment can be explained (and copied to report it). OTP texts are never kept.
    private fun logPrefs(ctx: Context, name: String) = ctx.getSharedPreferences(name, Context.MODE_PRIVATE)
    @Synchronized private fun readLog(ctx: Context, name: String): JSONArray =
        logPrefs(ctx, name).getString("log", null)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
    @Synchronized private fun writeLog(ctx: Context, name: String, at: Long, sender: String?, text: String, outcome: String, detail: String) {
        val key = "${sender.orEmpty()}|$at|${text.hashCode()}"
        val old = readLog(ctx, name)
        val next = JSONArray()
        next.put(JSONObject().put("key", key).put("at", at).put("sender", sender.orEmpty()).put("outcome", outcome).put("detail", detail)
            .put("text", if (outcome == "otp") "" else text.take(600)))
        // Newest first; one row per message (a look-back re-reads the same SMS: keep the latest outcome).
        for (i in 0 until old.length()) { val r = old.getJSONObject(i); if (r.optString("key") != key && next.length() < 300) next.put(r) }
        // Keep it sorted by message time, newest first.
        val rows = (0 until next.length()).map { next.getJSONObject(it) }.sortedByDescending { it.optLong("at") }
        logPrefs(ctx, name).edit().putString("log", JSONArray(rows).toString()).apply()
    }
    fun smsLog(ctx: Context): JSONArray = readLog(ctx, "echopdo_smslog")
    fun logSms(ctx: Context, at: Long, sender: String?, text: String, outcome: String, detail: String) = writeLog(ctx, "echopdo_smslog", at, sender, text, outcome, detail)
    fun clearSmsLog(ctx: Context) { logPrefs(ctx, "echopdo_smslog").edit().remove("log").apply() }
    fun upiLog(ctx: Context): JSONArray = readLog(ctx, "echopdo_upilog")
    fun logUpi(ctx: Context, at: Long, app: String, text: String, outcome: String, detail: String) = writeLog(ctx, "echopdo_upilog", at, app, text, outcome, detail)
    fun clearUpiLog(ctx: Context) { logPrefs(ctx, "echopdo_upilog").edit().remove("log").apply() }

    // ----- GPay / Paytm notifications -----
    // On unless turned off in the app (Android's "Notification access" must also be allowed).
    fun upiEnabled(ctx: Context) = prefs(ctx).getBoolean("upi", true)
    fun setUpiEnabled(ctx: Context, on: Boolean) { prefs(ctx).edit().putBoolean("upi", on).apply() }
    /** Recent payment notices waiting for their bank SMS: [{ key, at, direction, amount, name, app, state }]. state: open | named | sent */
    @Synchronized fun upiRecent(ctx: Context): JSONArray {
        val cutoff = System.currentTimeMillis() - 24 * 3600_000L
        val all = prefs(ctx).getString("upiRecent", null)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
        val keep = JSONArray()
        for (i in 0 until all.length()) { val r = all.getJSONObject(i); if (r.optLong("at") >= cutoff) keep.put(r) }
        return keep
    }
    @Synchronized fun setUpiRecent(ctx: Context, a: JSONArray) { prefs(ctx).edit().putString("upiRecent", a.toString()).apply() }

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
