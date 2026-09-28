package app.echopdo

import android.app.Activity
import android.app.DatePickerDialog
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter

// The quick-add sheet: Hisab (default) or Budget, calculator keypad, category / book / source
// (or account) chips, date and note. Opened from the widget, the app-icon shortcuts and the
// quick-settings tile. Only adds — nothing from the household is shown except picker names.
class QuickAddActivity : Activity() {
    private var target = "hisab"
    private var direction = "out"
    private var expr = ""
    private var category: String? = null      // Hisab: name; Budget: id
    private var categoryName: String? = null
    private var bookId: String? = null
    private var source: String? = null
    private var accountId: String? = null
    private var date: LocalDate = LocalDate.now()
    private var busy = false
    private var capture: JSONObject? = null   // a payment read from a bank SMS (fixed amount/date)
    private var always = false                // file this payee like this automatically from now on

    private lateinit var title: TextView
    private lateinit var targetSeg: Segmented
    private lateinit var dirSeg: Segmented
    private lateinit var amountView: TextView
    private lateinit var exprView: TextView
    private lateinit var pickers: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var note: EditText
    private lateinit var status: TextView
    private lateinit var banner: TextView
    private lateinit var saveBtn: TextView
    private lateinit var nextBtn: TextView
    private lateinit var keypadView: View
    private lateinit var captureInfo: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Store.paired(this)) {
            startActivity(Intent(this, PairActivity::class.java)); finish(); return
        }
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        target = Store.defaultTarget(this)
        applyIntent(intent)
        setContentView(build())
        capture?.let { c -> note.setText(c.optString("payee").takeIf { it.isNotEmpty() && it != "null" } ?: "") }
        render()
        Thread {
            val cfg = runCatching { Api.refreshConfig(this) }
            val update = Updates.check(this)
            if (update) Updates.schedule(this, now = true)
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                cfg.exceptionOrNull()?.let { e -> if (e is ApiError && e.unpaired) { startActivity(Intent(this, PairActivity::class.java)); finish(); return@runOnUiThread } }
                if (cfg.isSuccess) render()
                banner.visibility = if (update) View.VISIBLE else View.GONE
            }
        }.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        expr = ""; category = null; categoryName = null; accountId = null; source = null; bookId = null; date = LocalDate.now(); always = false
        target = Store.defaultTarget(this)
        applyIntent(intent)
        note.setText(capture?.optString("payee")?.takeIf { it.isNotEmpty() && it != "null" } ?: "")
        render()
    }

    private fun applyIntent(i: Intent?) {
        direction = if (i?.getStringExtra("direction") == "in") "in" else "out"
        i?.getStringExtra("target")?.let { if (it == "hisab" || it == "budget") target = it }
        capture = i?.getStringExtra("capture")?.let { runCatching { JSONObject(it) }.getOrNull() }
        capture?.let { c ->
            direction = if (c.optString("direction") == "in") "in" else "out"
            expr = c.optDouble("amount").let { if (it == Math.floor(it)) it.toLong().toString() else it.toString() }
            date = runCatching { LocalDate.parse(c.optString("date")) }.getOrDefault(LocalDate.now())
            source = if (c.optBoolean("card")) "Card" else "UPI"
            c.optString("account_id").takeIf { it.isNotEmpty() && it != "null" }?.let { accountId = it }
            (c.optJSONObject("suggestion") ?: c.optJSONObject("guess"))?.let { s ->
                val str = { k: String -> s.optString(k).takeIf { it.isNotEmpty() && it != "null" } }
                str("target")?.let { target = it }
                if (target == "budget") { category = str("category_id"); categoryName = str("label") } else { category = str("category"); categoryName = category }
                str("account_id")?.let { accountId = it }
                str("source")?.let { source = it }
                str("book_id")?.let { bookId = it }
            }
        }
    }

    // ----- Layout -----
    private fun build(): View {
        val root = FrameLayout(this).apply { setOnClickListener { finish() } }
        val sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(C.card, dp(24).toFloat()).apply {
                cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)
            }
            setPadding(dp(16), dp(10), dp(16), dp(12))
            isClickable = true
        }
        val h = (resources.displayMetrics.heightPixels * 0.88).toInt()
        root.addView(sheet, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h, Gravity.BOTTOM))

        // Grab handle
        sheet.addView(View(this).apply { background = rounded(C.line, dp(3).toFloat()) },
            LinearLayout.LayoutParams(dp(40), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(10) })

        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        title = label("eChopdo", 14f, C.muted).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
        head.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        targetSeg = Segmented(this, listOf("Hisab", "Budget")) { i ->
            target = if (i == 0) "hisab" else "budget"; category = null; categoryName = null; render()
        }
        head.addView(targetSeg, LinearLayout.LayoutParams(dp(170), ViewGroup.LayoutParams.WRAP_CONTENT))
        sheet.addView(head)

        banner = label("⬆  A new version of eChopdo is ready — tap to update", 13f, C.accent).apply {
            background = rounded(C.accent2, dp(10).toFloat())
            setPadding(dp(12), dp(8), dp(12), dp(8))
            visibility = View.GONE
            setOnClickListener {
                // Allowed to update itself: download and install now; otherwise ask for that once.
                if (Updates.canInstall(this@QuickAddActivity)) {
                    text = "⬆  Downloading the update…"
                    Thread { runCatching { Updates.run(applicationContext, force = true) }.onFailure {
                        runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Updates.PAGE))) } } }.start()
                } else startActivity(Updates.allowIntent(this@QuickAddActivity))
            }
        }
        sheet.addView(banner, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })

        dirSeg = Segmented(this, listOf("Spent", "Received"), listOf(C.neg, C.pos)) { i ->
            direction = if (i == 0) "out" else "in"; category = null; categoryName = null; render()
        }
        sheet.addView(dirSeg, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })

        amountView = label("₹0", 34f, C.neg, true).apply { gravity = Gravity.END; typeface = Typeface.create("monospace", Typeface.BOLD) }
        exprView = label("", 13f, C.muted).apply { gravity = Gravity.END; typeface = Typeface.MONOSPACE }
        sheet.addView(amountView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
        sheet.addView(exprView)
        captureInfo = label("", 13f, C.muted).apply { gravity = Gravity.END; visibility = View.GONE }
        sheet.addView(captureInfo)

        pickers = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll = ScrollView(this).apply { addView(pickers); isVerticalScrollBarEnabled = false }
        sheet.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        note = EditText(this).apply {
            hint = "Note (optional)"
            setHintTextColor(C.muted); setTextColor(C.text)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            background = rounded(C.bg, dp(10).toFloat(), C.line, dp(1))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_DONE
            maxLines = 1
        }

        keypadView = keypad()
        sheet.addView(keypadView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })

        status = label("", 13f, C.neg).apply { visibility = View.GONE; setPadding(dp(4), dp(6), dp(4), 0) }
        sheet.addView(status)

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        nextBtn = label("Save & next", 15f, C.text, true).apply {
            gravity = Gravity.CENTER
            background = rounded(C.card2, dp(14).toFloat(), C.line, dp(1))
            setOnClickListener { if (capture != null) ignoreCapture() else save(keepOpen = true) }
        }
        saveBtn = label("Save", 16f, C.bg, true).apply {
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.btn_primary)
            setOnClickListener { save(keepOpen = false) }
        }
        actions.addView(nextBtn, LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginEnd = dp(6) })
        actions.addView(saveBtn, LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginStart = dp(6) })
        sheet.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        return root
    }

    private fun keypad(): View {
        val keys = listOf("7", "8", "9", "⌫", "4", "5", "6", "×", "1", "2", "3", "−", ".", "0", "00", "+")
        val grid = GridLayout(this).apply { columnCount = 4 }
        keys.forEach { k ->
            val op = k in listOf("⌫", "×", "−", "+")
            val key = label(k, 20f, if (op) C.accent else C.text, !op).apply {
                gravity = Gravity.CENTER
                background = rounded(if (op) C.accent2 else C.card2, dp(12).toFloat())
                setOnClickListener { press(k) }
                if (k == "⌫") setOnLongClickListener { expr = ""; renderAmount(); true }
            }
            grid.addView(key, GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply {
                width = 0; height = dp(48); setMargins(dp(3), dp(3), dp(3), dp(3))
            })
        }
        return grid
    }

    private fun press(k: String) {
        val ops = "+−×"
        when (k) {
            "⌫" -> expr = expr.dropLast(1)
            "+", "−", "×" -> if (expr.isNotEmpty()) expr = if (expr.last() in ops) expr.dropLast(1) + k else expr + k
            "." -> { val cur = expr.split('+', '−', '×').last(); if ('.' !in cur) expr += if (cur.isEmpty()) "0." else "." }
            else -> {
                val cur = expr.split('+', '−', '×').last()
                val dec = cur.substringAfter('.', "")
                if ('.' in cur && dec.length + k.length > 2) return
                if (expr.length < 40) expr += k
            }
        }
        status.visibility = View.GONE
        renderAmount()
    }

    // ----- Render -----
    private fun cfg(): JSONObject? = Store.config(this)

    private fun render() {
        val c = cfg()
        val hh = c?.optJSONObject("household")?.optString("name").orEmpty().ifEmpty { Store.household(this) }
        title.text = if (hh.isEmpty()) "eChopdo" else "eChopdo · $hh"
        targetSeg.select(if (target == "budget") 1 else 0)
        dirSeg.select(if (direction == "in") 1 else 0)
        val labels = if (target == "budget") listOf("Expense", "Income") else listOf("Spent", "Received")
        (dirSeg.getChildAt(0) as TextView).text = labels[0]
        (dirSeg.getChildAt(1) as TextView).text = labels[1]
        val cap = capture
        dirSeg.visibility = if (cap != null) View.GONE else View.VISIBLE
        keypadView.visibility = if (cap != null) View.GONE else View.VISIBLE
        captureInfo.visibility = if (cap != null) View.VISIBLE else View.GONE
        if (cap != null) captureInfo.text = listOf(Captures.subtitle(cap), "from bank SMS").filter { it.isNotEmpty() }.joinToString(" · ")
        val refile = cap?.optBoolean("refile") == true
        nextBtn.text = if (cap != null) (if (refile) "Remove" else "Ignore") else "Save & next"
        saveBtn.text = if (cap != null) (if (refile) "Save" else "Add") else "Save"
        renderAmount()
        renderPickers(c)
    }

    private fun renderAmount() {
        val v = Calc.evaluate(expr)
        amountView.text = Calc.money(v ?: 0.0)
        amountView.setTextColor(if (direction == "in") C.pos else C.neg)
        exprView.text = if (Regex("[+−×]").containsMatchIn(expr)) expr else ""
        exprView.visibility = if (exprView.text.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun renderPickers(c: JSONObject?) {
        val y = scroll.scrollY
        pickers.removeAllViews()
        scroll.post { scroll.scrollTo(0, y) }
        if (c == null) {
            pickers.addView(label("Loading your categories…", 14f, C.muted).apply { setPadding(0, dp(16), 0, 0) })
            return
        }
        if (target == "hisab") hisabPickers(c.getJSONObject("hisab")) else budgetPickers(c.getJSONObject("budget"))
        datePicker()
    }

    private fun flow(): FlowLayout = FlowLayout(this).also { pickers.addView(it) }

    private fun hisabPickers(h: JSONObject) {
        val cats = h.optJSONArray(if (direction == "in") "in" else "out") ?: JSONArray()
        // Book first: out shopping for an occasion, pick it once — it stays picked for 3 hours.
        val books = h.optJSONArray("books") ?: JSONArray()
        val ids = (0 until books.length()).map { books.getJSONObject(it).optString("id") }
        if (bookId == null || bookId !in ids) bookId = Store.recentBook(this)?.takeIf { it in ids && capture == null } ?: ids.firstOrNull()
        if (books.length() > 1) {
            pickers.addView(section("Book"))
            val fb = flow()
            for (i in 0 until books.length()) {
                val b = books.getJSONObject(i)
                val id = b.optString("id")
                val daily = b.optString("kind") == "daily"
                fb.addView(chip((if (daily) "🗓️ " else "📒 ") + b.optString("name"), bookId == id) {
                    bookId = id; Store.setRecentBook(this, if (daily) null else id); render()
                })
            }
        }
        pickers.addView(section("Category"))
        val f = flow()
        for (i in 0 until cats.length()) {
            val cat = cats.getJSONObject(i)
            val name = cat.optString("name")
            f.addView(chip("${cat.optString("icon")}  $name", category == name) {
                if (category == name) { category = null; categoryName = null } else { category = name; categoryName = name }
                render()
            })
        }
        val sources = h.optJSONArray("sources") ?: JSONArray()
        pickers.addView(section(if (direction == "in") "Received in" else "Paid by"))
        val fs = flow()
        for (i in 0 until sources.length()) {
            val s = sources.getString(i)
            fs.addView(chip(s, source == s) { source = if (source == s) null else s; render() })
        }
    }

    private fun budgetPickers(b: JSONObject) {
        val cats = b.optJSONArray(if (direction == "in") "income" else "expense") ?: JSONArray()
        pickers.addView(section("Category"))
        val f = flow()
        for (i in 0 until cats.length()) {
            val cat = cats.getJSONObject(i)
            val id = cat.optString("id")
            val tint = runCatching { android.graphics.Color.parseColor(cat.optString("color")) }.getOrDefault(C.accent)
            f.addView(chip("●  ${cat.optString("name")}", category == id, tint) {
                if (category == id) { category = null; categoryName = null } else { category = id; categoryName = cat.optString("name") }
                render()
            }.apply { if (category != id) setTextColor(C.text) })
        }
        if (cats.length() == 0) pickers.addView(label("No categories yet — add them in eChopdo.", 13f, C.muted))
        val accounts = b.optJSONArray("accounts") ?: JSONArray()
        if (accounts.length() > 0) {
            pickers.addView(section("Account"))
            val fa = flow()
            for (i in 0 until accounts.length()) {
                val a = accounts.getJSONObject(i)
                val id = a.optString("id")
                val tint = runCatching { android.graphics.Color.parseColor(a.optString("color")) }.getOrDefault(C.accent)
                fa.addView(chip(a.optString("name"), accountId == id, tint) { accountId = if (accountId == id) null else id; render() })
            }
        }
    }

    private fun datePicker() {
        pickers.addView(section("Date"))
        val f = flow()
        val today = LocalDate.now()
        f.addView(chip("Today", date == today) { date = today; render() })
        f.addView(chip("Yesterday", date == today.minusDays(1)) { date = today.minusDays(1); render() })
        val other = date != today && date != today.minusDays(1)
        f.addView(chip(if (other) "📅  " + date.format(DateTimeFormatter.ofPattern("d MMM")) else "📅  Pick…", other) {
            DatePickerDialog(this, android.R.style.Theme_DeviceDefault_Dialog_Alert, { _, y, m, d -> date = LocalDate.of(y, m + 1, d); render() },
                date.year, date.monthValue - 1, date.dayOfMonth).apply { datePicker.maxDate = System.currentTimeMillis() + 86_400_000L * 60 }.show()
        })
        (note.parent as? ViewGroup)?.removeView(note)
        pickers.addView(note, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        val payee = capture?.optString("payee")?.takeIf { it.isNotEmpty() && it != "null" }
        if (payee != null) {
            pickers.addView(chip((if (always) "✓  " else "") + "Always add $payee like this", always) { always = !always; render() },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        }
        pickers.addView(View(this), LinearLayout.LayoutParams(1, dp(8)))
    }

    // ----- Save -----
    // ----- Captured payment: file it (or ignore it) -----
    private fun fileCapture() {
        val cap = capture ?: return
        val body = JSONObject().put("action", if (cap.optBoolean("refile")) "refile" else "file").put("capture_id", cap.optString("id")).put("target", target)
        note.text.toString().trim().takeIf { it.isNotEmpty() }?.let { body.put("note", it) }
        if (target == "budget") { category?.let { body.put("category_id", it) }; accountId?.let { body.put("account_id", it) } }
        else { category?.let { body.put("category", it) }; source?.let { body.put("source", it) }; bookId?.let { body.put("book_id", it) } }
        if (always) body.put("auto", true)
        send(body, "Added ${Calc.money(cap.optDouble("amount"))}${categoryName?.let { " · $it" } ?: ""}")
    }

    private fun ignoreCapture() {
        val cap = capture ?: return
        val refile = cap.optBoolean("refile")
        send(JSONObject().put("action", if (refile) "unfile" else "ignore").put("capture_id", cap.optString("id")), if (refile) "Removed" else "Ignored")
    }

    private fun send(body: JSONObject, done: String) {
        if (busy) return
        busy = true; saveBtn.alpha = 0.5f; nextBtn.alpha = 0.5f
        val nid = capture?.let { Captures.nid(it) }
        Thread {
            val err = try { Api.call(applicationContext, body); null }
                catch (e: ApiError) { e.message ?: "Could not save." } catch (e: java.io.IOException) { "No internet — try again." }
            runOnUiThread {
                busy = false; saveBtn.alpha = 1f; nextBtn.alpha = 1f
                if (err != null) showError(err) else {
                    nid?.let { Notify.cancel(this, it) }
                    Toast.makeText(this, done, Toast.LENGTH_SHORT).show(); finish()
                }
            }
            if (err == null) runCatching { Api.refreshConfig(applicationContext) }
        }.start()
    }

    private fun save(keepOpen: Boolean) {
        if (capture != null) { fileCapture(); return }
        if (busy) return
        val amount = Calc.evaluate(expr)
        if (amount == null || amount <= 0) { showError("Enter an amount."); return }
        val entry = JSONObject().put("target", target).put("amount", amount).put("date", date.toString())
        note.text.toString().trim().takeIf { it.isNotEmpty() }?.let { entry.put("note", it) }
        if (target == "budget") {
            entry.put("kind", if (direction == "in") "income" else "expense")
            category?.let { entry.put("category_id", it).put("category_name", categoryName) }
            accountId?.let { entry.put("account_id", it) }
        } else {
            entry.put("direction", direction)
            category?.let { entry.put("category", it) }
            source?.let { entry.put("source", it) }
            bookId?.let { entry.put("book_id", it) }
        }
        busy = true
        saveBtn.alpha = 0.5f; nextBtn.alpha = 0.5f
        Thread {
            val res = Repo.save(applicationContext, entry)
            runOnUiThread {
                busy = false
                saveBtn.alpha = 1f; nextBtn.alpha = 1f
                when (res) {
                    is SaveResult.Failed -> {
                        showError(res.message)
                        if (res.unpaired) { startActivity(Intent(this, PairActivity::class.java)); finish() }
                    }
                    else -> {
                        val where = if (target == "budget") "Budget" else "Hisab"
                        Toast.makeText(this, if (res is SaveResult.Queued) "Saved offline — will send when online" else "Saved ${Notify.label(entry)} to $where", Toast.LENGTH_SHORT).show()
                        if (keepOpen) { expr = ""; note.setText(""); renderAmount() } else finish()
                    }
                }
            }
            if (res is SaveResult.Saved) runCatching { Api.refreshConfig(applicationContext) }
        }.start()
    }

    private fun showError(msg: String) {
        status.text = msg
        status.visibility = View.VISIBLE
    }
}
