package app.echopdo

// Calculator input like the web Hisab sheet: numbers joined by + − × (× binds tighter).
object Calc {
    fun evaluate(expr: String): Double? {
        val tokens = Regex("""\d*\.?\d+|[+\-*]""").findAll(expr.replace('−', '-').replace('×', '*')).map { it.value }.toList()
        if (tokens.isEmpty() || tokens.last() in listOf("+", "-", "*")) return null
        val terms = mutableListOf<Double>()
        var sign = 1.0
        var product: Double? = null
        var mul = false
        for (t in tokens) {
            when (t) {
                "+", "-" -> { terms.add(sign * (product ?: 0.0)); sign = if (t == "-") -1.0 else 1.0; product = null; mul = false }
                "*" -> mul = true
                else -> { val n = t.toDouble(); product = if (mul && product != null) product * n else n; mul = false }
            }
        }
        terms.add(sign * (product ?: 0.0))
        val total = terms.sum()
        return if (total.isFinite()) Math.round(total * 100) / 100.0 else null
    }

    fun money(v: Double): String {
        val whole = v == Math.floor(v)
        val f = java.text.NumberFormat.getNumberInstance(java.util.Locale("en", "IN"))
        f.maximumFractionDigits = if (whole) 0 else 2
        f.minimumFractionDigits = if (whole) 0 else 2
        return "₹" + f.format(v)
    }
}
