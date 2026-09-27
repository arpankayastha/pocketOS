package app.echopdo

import android.Manifest
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.google.androidbrowserhelper.trusted.LauncherActivity
import org.json.JSONObject

// Pairs this phone with a household: eChopdo → Settings → Phone widget → "Pair this phone"
// opens echopdo://pair?code=…, or the code is typed here. Also shows the paired state.
class PairActivity : Activity() {
    private lateinit var body: LinearLayout
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        val root = FrameLayout(this).apply { setOnClickListener { finish() } }
        body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(C.card, dp(24).toFloat()).apply {
                cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)
            }
            setPadding(dp(20), dp(20), dp(20), dp(24))
            isClickable = true
        }
        root.addView(body, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        setContentView(root)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(i: Intent?) {
        val code = i?.data?.takeIf { it.scheme == "echopdo" }?.getQueryParameter("code")
        if (code != null) pair(code) else if (Store.paired(this)) showPaired(null) else showForm(null)
    }

    private fun heading(text: String) = label(text, 20f, C.text, true).apply { setPadding(0, 0, 0, dp(6)) }
    private fun para(text: String) = label(text, 14f, C.muted).apply { setPadding(0, 0, 0, dp(14)); setLineSpacing(0f, 1.2f) }
    private fun button(text: String, primary: Boolean, onClick: () -> Unit) = label(text, 15f, if (primary) C.bg else C.text, true).apply {
        gravity = Gravity.CENTER
        if (primary) setBackgroundResource(R.drawable.btn_primary) else background = rounded(C.card2, dp(14).toFloat(), C.line, dp(1))
        setOnClickListener { onClick() }
    }
    private fun add(v: View, top: Int = 0, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT) =
        body.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h).apply { topMargin = dp(top) })

    private fun showForm(error: String?) {
        body.removeAllViews()
        add(heading("Pair with eChopdo"))
        add(para("In eChopdo open ⚙ Settings → Phone widget → Pair a phone, then tap “Pair this phone” — or type the 8-character code here."))
        val input = EditText(this).apply {
            hint = "XXXX-XXXX"
            setHintTextColor(C.muted); setTextColor(C.text)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            typeface = Typeface.create("monospace", Typeface.BOLD)
            letterSpacing = 0.12f
            gravity = Gravity.CENTER
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(InputFilter.AllCaps(), InputFilter.LengthFilter(9))
            background = rounded(C.bg, dp(12).toFloat(), C.line, dp(1))
            setPadding(dp(12), dp(14), dp(12), dp(14))
        }
        add(input)
        if (error != null) add(label(error, 14f, C.neg).apply { setPadding(0, dp(10), 0, 0) })
        add(button("Pair", true) { pair(input.text.toString()) }, 14, dp(52))
        add(button("Open eChopdo", false) { openApp() }, 10, dp(48))
    }

    private fun pair(code: String) {
        if (busy) return
        busy = true
        body.removeAllViews()
        add(heading("Pairing…"))
        add(para("Checking the code with eChopdo."))
        Thread {
            val result = runCatching {
                val res = Api.call(this, JSONObject().put("action", "pair").put("code", code).put("name", deviceName()))
                Store.savePairing(this, res.getString("token"), res.optString("household"))
                runCatching { Api.refreshConfig(this) }
                res.optString("household")
            }
            runOnUiThread {
                busy = false
                result.fold(
                    { hh -> QuickWidget.refreshAll(this); askNotifications(); showPaired(hh) },
                    { e -> showForm(if (e is ApiError) e.message else "No internet — try again.") },
                )
            }
        }.start()
    }

    private fun showPaired(justPaired: String?) {
        body.removeAllViews()
        val hh = Store.household(this)
        val target = if (Store.defaultTarget(this) == "budget") "Budget" else "Hisab"
        add(heading(if (justPaired != null) "✓ Paired with ${justPaired.ifEmpty { "eChopdo" }}" else "Paired with ${hh.ifEmpty { "eChopdo" }}"))
        add(para("Quick add saves to $target (change it in eChopdo → Settings → Phone widget). Add the widget to your home screen, or long-press the eChopdo icon for Spent / Received."))
        val mgr = getSystemService(AppWidgetManager::class.java)
        if (mgr.isRequestPinAppWidgetSupported) {
            add(button("Add widget to home screen", true) {
                mgr.requestPinAppWidget(ComponentName(this, QuickWidget::class.java), null, null)
            }, 0, dp(52))
        } else {
            add(para("Long-press the home screen → Widgets → eChopdo."))
        }
        add(button("Try quick add", false) {
            startActivity(QuickWidget.quickIntent(this, "out")); finish()
        }, 10, dp(48))
        if (justPaired == null) {
            add(button("Pair with a new code", false) { showForm(null) }, 10, dp(48))
            add(label("Unpair this phone", 14f, C.neg).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(14), 0, 0)
                setOnClickListener { Store.unpair(this@PairActivity); QuickWidget.refreshAll(this@PairActivity); showForm(null) }
            })
        }
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun openApp() {
        startActivity(Intent(this, LauncherActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); finish()
    }

    private fun deviceName(): String {
        val m = Build.MODEL ?: "Phone"
        return if (m.startsWith("SM-S928")) "Galaxy S24 Ultra" else m
    }

}
