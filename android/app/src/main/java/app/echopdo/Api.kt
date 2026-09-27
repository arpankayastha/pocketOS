package app.echopdo

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiError(message: String, val unpaired: Boolean = false) : Exception(message)

// The `quickadd` Edge Function. Call from a background thread. Throws IOException when
// offline (the caller may queue) and ApiError when the server said no.
object Api {
    // var only so tests can point it elsewhere.
    internal var endpoint = "${BuildConfig.SUPABASE_URL}/functions/v1/quickadd"

    fun call(ctx: Context, body: JSONObject): JSONObject {
        if (body.optString("action") != "pair") {
            val token = Store.token(ctx) ?: throw ApiError("This phone is not paired.", unpaired = true)
            body.put("token", token)
        }
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", BuildConfig.ANON_KEY)
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (code in 200..299) return json
            if (code >= 500 && !json.has("error")) throw IOException("Server error $code")
            val unpaired = json.optBoolean("unpaired")
            if (unpaired) Store.unpair(ctx)
            throw ApiError(json.optString("error").ifEmpty { "Something went wrong ($code)." }, unpaired)
        } finally {
            conn.disconnect()
        }
    }

    fun refreshConfig(ctx: Context): JSONObject {
        val cfg = call(ctx, JSONObject().put("action", "config"))
        Store.saveConfig(ctx, cfg)
        QuickWidget.refreshAll(ctx)
        return cfg
    }
}
