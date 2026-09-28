package app.echopdo

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import com.google.androidbrowserhelper.trusted.TwaLauncher

// App icon → the eChopdo web app full screen in Chrome (Trusted Web Activity). Always uses
// Chrome when installed (that's where the login and fingerprint live — not Samsung Internet),
// shows its own screen meanwhile, and explains on screen if opening fails.
class MainActivity : Activity() {
    private var launcher: TwaLauncher? = null
    private var launched = false
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var detail: TextView
    private lateinit var actions: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(build())
        Updates.schedule(this, now = true)
        val crash = Crash.last(this)
        if (crash != null) {
            Crash.clear(this)
            trouble("eChopdo stopped last time", crash, report = crash)
        } else launch()
    }

    // Coming back here from the web app (back button) means the user is leaving.
    override fun onRestart() {
        super.onRestart()
        if (launched) finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        launcher?.destroy()
    }

    private fun build(): View {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(96), dp(24), dp(32))
        }
        col.addView(ImageView(this).apply { setImageResource(R.drawable.splash) }, LinearLayout.LayoutParams(dp(88), dp(88)))
        status = label("Opening eChopdo…", 16f, C.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(20), 0, 0) }
        col.addView(status)
        detail = label("", 12f, C.muted).apply { typeface = Typeface.MONOSPACE; visibility = View.GONE; setPadding(0, dp(12), 0, 0); setTextIsSelectable(true) }
        col.addView(detail, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        col.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20) })
        col.addView(label("v${BuildConfig.VERSION_NAME}", 11f, C.muted).apply { setPadding(0, dp(24), 0, 0) })
        return ScrollView(this).apply { setBackgroundColor(C.bg); isFillViewport = true; addView(col) }
    }

    private fun chrome(): String? = listOf("com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary").firstOrNull {
        runCatching { packageManager.getPackageInfo(it, 0); packageManager.getApplicationInfo(it, 0).enabled }.getOrDefault(false)
    }

    private fun url(): Uri {
        val web = Uri.parse(BuildConfig.WEB_URL)
        return intent?.data?.takeIf { it.scheme == "https" && it.host == web.host } ?: Uri.parse("${BuildConfig.WEB_URL}/")
    }

    private fun launch() {
        launched = false
        status.text = "Opening eChopdo…"
        detail.visibility = View.GONE; actions.visibility = View.GONE
        try {
            val pkg = chrome()
            launcher?.destroy()
            launcher = if (pkg != null) TwaLauncher(this, pkg) else TwaLauncher(this)
            val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(C.bg).setNavigationBarColor(C.bg).build()
            val builder = TrustedWebActivityIntentBuilder(url()).setDefaultColorSchemeParams(colors)
            launcher!!.launch(builder, null, null, { launched = true }, TwaLauncher.CCT_FALLBACK_STRATEGY)
            handler.postDelayed({
                if (!launched && !isFinishing) trouble("Chrome didn't open eChopdo", if (pkg == null) "Chrome isn't installed or is turned off." else "Chrome ($pkg) didn't respond.")
            }, 8000)
        } catch (e: Throwable) {
            Crash.save(this, e); Crash.clear(this)
            trouble("Couldn't open eChopdo", e.stackTraceToString().take(1500), report = e.stackTraceToString())
        }
    }

    private fun trouble(title: String, message: String, report: String? = null) {
        status.text = title
        status.setTextColor(C.text)
        detail.text = message
        detail.visibility = View.VISIBLE
        actions.removeAllViews()
        actions.visibility = View.VISIBLE
        fun btn(text: String, primary: Boolean = false, onClick: () -> Unit) = actions.addView(
            label(text, 15f, if (primary) C.bg else C.text, true).apply {
                gravity = Gravity.CENTER
                if (primary) setBackgroundResource(R.drawable.btn_primary) else background = rounded(C.card2, dp(14).toFloat(), C.line, dp(1))
                setOnClickListener { onClick() }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)).apply { topMargin = dp(10) })
        btn("Try again", primary = true) { launch() }
        btn("Open in Chrome") {
            val i = Intent(Intent.ACTION_VIEW, url()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            chrome()?.let { i.setPackage(it) }
            runCatching { startActivity(i) }.onFailure { startActivity(Intent(Intent.ACTION_VIEW, url())) }
        }
        btn("Quick add") { startActivity(QuickWidget.quickIntent(this, "out")) }
        if (report != null) btn("Copy error report") {
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("eChopdo error", report))
            Toast.makeText(this, "Copied — paste it to Claude", Toast.LENGTH_SHORT).show()
        }
    }
}
