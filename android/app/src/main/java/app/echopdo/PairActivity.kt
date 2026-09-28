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
import org.json.JSONObject

// Pairs this phone with a household: eChopdo → Settings → Phone widget → "Pair this phone"
// opens echopdo://pair?code=…, or the code is typed here. Also shows the paired state.
class PairActivity : Activity() {
    private companion object { const val SMS_REQUEST = 2 }
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
        val scroll = android.widget.ScrollView(this).apply { isVerticalScrollBarEnabled = false; addView(body) }
        root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
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
        add(para("Quick add saves to $target (change it in eChopdo → Settings → Phone widget). Add a widget to your home screen, or long-press the eChopdo icon for Spent / Received."))
        val mgr = getSystemService(AppWidgetManager::class.java)
        if (mgr.isRequestPinAppWidgetSupported) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(button("+ Widget", true) { mgr.requestPinAppWidget(ComponentName(this, QuickWidget::class.java), null, null) },
                LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(5) })
            row.addView(button("+ Small widget", false) { mgr.requestPinAppWidget(ComponentName(this, QuickWidgetSmall::class.java), null, null) },
                LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(5) })
            add(row)
        } else {
            add(para("Long-press the home screen → Widgets → eChopdo."))
        }
        smsSection()
        if (justPaired == null) {
            add(button("Pair with a new code", false) { showForm(null) }, 10, dp(48))
            add(label("Unpair this phone", 14f, C.neg).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(14), 0, 0)
                setOnClickListener { Store.unpair(this@PairActivity); QuickWidget.refreshAll(this@PairActivity); showForm(null) }
            })
        }
    }

    // ----- Bank SMS capture -----
    private fun smsSection() {
        add(label("BANK SMS", 11f, C.muted, true).apply { letterSpacing = 0.08f; setPadding(0, dp(22), 0, dp(6)) })
        if (Captures.active(this)) {
            add(para("On. When a bank SMS says money went out or came in, you get a notification to add it in one tap. Only the amount, date, last digits, payee and reference are sent — the SMS stays on this phone."))
            Store.smsStatus(this)?.let { add(label(it, 12f, C.accent).apply { setPadding(0, 0, 0, dp(10)) }) }
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(button("Look back 7 days", false) { scan(7) }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginEnd = dp(5) })
            row.addView(button("Turn off", false) { Store.setSmsEnabled(this, false); showPaired(null) }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginStart = dp(5) })
            add(row)
            add(button("Resync last 30 days", false) { Store.clearSeen(this); scan(30) }, 10, dp(46))
        } else {
            add(para("Read bank SMS on this phone so UPI and card payments show up ready to add — no typing. The SMS itself never leaves the phone."))
            add(button("Turn on bank SMS", true) {
                val perms = mutableListOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
                if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
                requestPermissions(perms.toTypedArray(), SMS_REQUEST)
            }, 0, dp(50))
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != SMS_REQUEST) return
        if (Captures.smsPermitted(this)) {
            Store.setSmsEnabled(this, true)
            showPaired(null)
            scan(7)
        } else showRestricted()
    }

    // Android 13+ hides SMS access from apps installed outside the Play Store until allowed.
    private fun showRestricted() {
        body.removeAllViews()
        add(heading("One more step"))
        add(para("Android blocks SMS access for apps installed from outside the Play Store. To allow it once:\n\n" +
            "1. Tap “Open app settings” below.\n2. Tap ⋮ (top right) → “Allow restricted settings”, confirm with your fingerprint.\n" +
            "3. Come back here and tap “Try again”, then Allow."))
        add(button("Open app settings", true) {
            startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }, 0, dp(50))
        add(button("Try again", false) {
            requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS), SMS_REQUEST)
        }, 10, dp(48))
        add(button("Back", false) { showPaired(null) }, 10, dp(48))
    }

    private fun scan(days: Int) {
        android.widget.Toast.makeText(this, "Looking through the last $days days…", android.widget.Toast.LENGTH_SHORT).show()
        Thread {
            val summary = runCatching { Captures.scanInbox(applicationContext, days) }.getOrElse { "Look-back failed: ${it.javaClass.simpleName} ${it.message.orEmpty()}".also { m -> Store.setSmsStatus(applicationContext, m) } }
            runOnUiThread {
                android.widget.Toast.makeText(this, summary, android.widget.Toast.LENGTH_LONG).show()
                if (!isFinishing) showPaired(null)
            }
        }.start()
    }

    // Coming back from Android settings (SMS allowed there): start capturing and look back once.
    override fun onResume() {
        super.onResume()
        if (Store.paired(this) && Captures.smsPermitted(this) && Store.smsStatus(this) == null && Store.smsEnabled(this)) {
            showPaired(null); scan(7)
        }
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun openApp() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); finish()
    }

    private fun deviceName(): String {
        val m = Build.MODEL ?: "Phone"
        return if (m.startsWith("SM-S928")) "Galaxy S24 Ultra" else m
    }

}
