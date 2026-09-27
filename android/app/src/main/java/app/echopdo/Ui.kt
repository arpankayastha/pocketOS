package app.echopdo

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

// Small helpers for the programmatic UI (same palette as the web app's dark theme).
object C {
    val bg = Color.parseColor("#050608")
    val card = Color.parseColor("#0d0f14")
    val card2 = Color.parseColor("#14171f")
    val line = Color.parseColor("#1f232d")
    val text = Color.parseColor("#e6e8ee")
    val muted = Color.parseColor("#8b93a5")
    val accent = Color.parseColor("#60a5fa")
    val accent2 = Color.parseColor("#0f1d36")
    val pos = Color.parseColor("#34d399")
    val neg = Color.parseColor("#f87171")
    fun alpha(color: Int, a: Float) = Color.argb((a * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))
}

fun Context.dp(v: Number) = (v.toFloat() * resources.displayMetrics.density).toInt()

fun rounded(color: Int, radius: Float, stroke: Int? = null, strokeWidth: Int = 2) = GradientDrawable().apply {
    setColor(color); cornerRadius = radius
    if (stroke != null) setStroke(strokeWidth, stroke)
}

fun Context.label(text: String, sp: Float = 14f, color: Int = C.text, bold: Boolean = false) = TextView(this).apply {
    this.text = text
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
    setTextColor(color)
    if (bold) typeface = Typeface.DEFAULT_BOLD
}

fun Context.section(text: String) = label(text.uppercase(), 11f, C.muted, true).apply {
    letterSpacing = 0.08f
    setPadding(dp(2), dp(14), 0, dp(6))
}

/** A pill-shaped choice. */
fun Context.chip(text: String, selected: Boolean, tint: Int = C.accent, onClick: () -> Unit) = label(text, 14f, if (selected) C.text else C.text).apply {
    gravity = Gravity.CENTER
    setPadding(dp(12), dp(8), dp(12), dp(8))
    minHeight = dp(40)
    background = if (selected) rounded(C.alpha(tint, 0.22f), dp(20).toFloat(), tint, dp(1.5f))
    else rounded(C.card2, dp(20).toFloat(), C.line, dp(1))
    setOnClickListener { onClick() }
}

/** Two or three equal buttons, one selected (like `.seg` on the web). */
class Segmented(ctx: Context, labels: List<String>, private val tints: List<Int>? = null, private val onPick: (Int) -> Unit) : LinearLayout(ctx) {
    private val buttons = labels.mapIndexed { i, s ->
        ctx.label(s, 14f, C.muted).apply {
            gravity = Gravity.CENTER
            minHeight = ctx.dp(40)
            setPadding(ctx.dp(8), 0, ctx.dp(8), 0)
            setOnClickListener { select(i); onPick(i) }
        }
    }
    var selected = 0; private set

    init {
        orientation = HORIZONTAL
        background = rounded(C.bg, ctx.dp(12).toFloat())
        setPadding(ctx.dp(4), ctx.dp(4), ctx.dp(4), ctx.dp(4))
        buttons.forEach { addView(it, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)) }
        select(0)
    }

    fun select(i: Int) {
        selected = i
        buttons.forEachIndexed { j, b ->
            val on = i == j
            b.setTextColor(if (on) tints?.getOrNull(j) ?: C.text else C.muted)
            b.typeface = if (on) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            b.background = if (on) rounded(C.card2, context.dp(9).toFloat()) else null
        }
    }
}

/** Lays children left-to-right, wrapping to new lines. */
class FlowLayout(ctx: Context, private val gap: Int = ctx.dp(8)) : ViewGroup(ctx) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        var x = 0; var y = 0; var lineH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == View.GONE) continue
            c.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            if (x > 0 && x + c.measuredWidth > width) { x = 0; y += lineH + gap; lineH = 0 }
            x += c.measuredWidth + gap
            lineH = maxOf(lineH, c.measuredHeight)
        }
        setMeasuredDimension(width, y + lineH)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val width = r - l
        var x = 0; var y = 0; var lineH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == View.GONE) continue
            if (x > 0 && x + c.measuredWidth > width) { x = 0; y += lineH + gap; lineH = 0 }
            c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight)
            x += c.measuredWidth + gap
            lineH = maxOf(lineH, c.measuredHeight)
        }
    }
}
