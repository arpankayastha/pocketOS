package app.echopdo

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// "SMS log": every bank / service SMS this phone looked at and what eChopdo did with it — added,
// already sent, skipped (and why), or not understood (and why). Lives only on this phone
// (Store.smsLog); "Copy" lets the owner send a misread message to get the reader fixed.
class SmsLogActivity : Activity() {
    private lateinit var list: LinearLayout
    private var filter = "all"
    private val upi by lazy { intent.getStringExtra("kind") == "upi" }
    private val fmt = DateTimeFormatter.ofPattern("d MMM, h:mm a")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(C.bg)
            setPadding(dp(16), dp(20), dp(16), 0)
        }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(label("‹", 26f, C.text, true).apply { setPadding(0, 0, dp(14), 0); setOnClickListener { finish() } })
        head.addView(label(if (upi) "UPI log" else "SMS log", 20f, C.text, true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        head.addView(label("Clear", 14f, C.muted).apply {
            setPadding(dp(10), dp(8), 0, dp(8))
            setOnClickListener { if (upi) Store.clearUpiLog(this@SmsLogActivity) else Store.clearSmsLog(this@SmsLogActivity); render() }
        })
        root.addView(head)
        root.addView(label(if (upi) "GPay and Paytm notifications this phone read and what happened to each. The text stays on this phone. Tap Copy on one that was read wrong to send it for fixing."
            else "Bank SMS this phone read and what happened to each. The text stays on this phone. " +
            "Tap Copy on one that went wrong to send it for fixing.", 13f, C.muted).apply { setPadding(0, dp(6), 0, dp(10)); setLineSpacing(0f, 1.2f) })
        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; tag = "chips" }
        root.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chips) })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(10), 0, dp(24)) }
        root.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        render()
    }

    private fun rows() = (if (upi) Store.upiLog(this) else Store.smsLog(this)).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }

    private fun render() {
        val all = rows()
        val chips = (window.decorView.findViewWithTag<LinearLayout>("chips"))
        chips.removeAllViews()
        val groups = listOf("all" to "All", "sent" to (if (upi) "Used" else "Added"), "skip" to "Skipped", "unknown" to "Not understood")
        for ((id, name) in groups) {
            val n = all.count { matches(it, id) }
            chips.addView(chip("$name $n", filter == id) { filter = id; render() },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
        }
        list.removeAllViews()
        val shown = all.filter { matches(it, filter) }
        if (shown.isEmpty()) {
            list.addView(label(if (all.isEmpty()) if (upi) "Nothing yet. Payments shown by GPay or Paytm will appear here." else "Nothing yet. New bank SMS show up here; “Look back” fills it with older ones." else "None here.", 14f, C.muted).apply { setPadding(0, dp(20), 0, 0) })
            return
        }
        for (r in shown) list.addView(row(r), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) })
    }

    private fun matches(r: JSONObject, id: String) = when (id) {
        "all" -> true
        "sent" -> r.optString("outcome") in setOf("sent", "wait")
        "skip" -> r.optString("outcome") in setOf("skip", "otp")
        else -> r.optString("outcome") in setOf("unknown", "error")
    }

    private fun row(r: JSONObject): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(C.card, dp(14).toFloat(), C.line, dp(1))
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val outcome = r.optString("outcome")
        val (badge, color) = when (outcome) {
            "sent" -> (if (upi) "Used" else "Added") to C.pos
            "wait" -> "Waiting" to C.accent
            "skip", "otp" -> "Skipped" to C.muted
            "error" -> "Error" to C.neg
            else -> "Not understood" to C.neg
        }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val time = Instant.ofEpochMilli(r.optLong("at")).atZone(ZoneId.systemDefault()).format(fmt)
        top.addView(label("$time · ${r.optString("sender")}", 12f, C.muted).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(label(badge, 12f, color, true).apply {
            background = rounded(C.alpha(color, 0.15f), dp(10).toFloat()); setPadding(dp(8), dp(2), dp(8), dp(2))
        })
        box.addView(top)
        box.addView(label(r.optString("detail"), 14f, C.text, true).apply { setPadding(0, dp(6), 0, 0) })
        val text = r.optString("text")
        if (text.isNotEmpty()) {
            val body = label(text, 13f, C.muted).apply { maxLines = 3; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, dp(4), 0, 0); setLineSpacing(0f, 1.15f) }
            body.setOnClickListener { body.maxLines = if (body.maxLines == 3) 50 else 3 }
            box.addView(body)
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, 0) }
            actions.addView(chip("Copy", false) {
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(if (upi) "UPI" else "SMS", "${r.optString("sender")}: $text"))
                Toast.makeText(this, "Copied — paste it to report this SMS", Toast.LENGTH_SHORT).show()
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
            if (outcome != "sent") actions.addView(chip("Add by hand", false) {
                val amount = Regex("(?i)(?:rs\\.?|inr|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)").find(text)?.groupValues?.get(1)?.replace(",", "")
                val inward = Regex("(?i)\\b(credited|received|deposited)\\b").containsMatchIn(text)
                startActivity(Intent(this, QuickAddActivity::class.java)
                    .putExtra("direction", if (inward) "in" else "out")
                    .apply { amount?.let { putExtra("amount", it) } }
                    .putExtra("date", Instant.ofEpochMilli(r.optLong("at")).atZone(ZoneId.systemDefault()).toLocalDate().toString()))
            })
            box.addView(actions)
        }
        return box
    }
}
