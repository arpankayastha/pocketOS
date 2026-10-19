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

    // "65000+1200.5" → "65,000+1,200.5": every number in a calculator line grouped the Indian way (lakh, crore), so zeros can be counted.
    fun groupExpr(expr: String): String = Regex("""(\d+)(\.\d*)?""").replace(expr) { m -> indian(m.groupValues[1]) + m.groupValues[2] }

    private fun indian(digits: String): String {
        val d = digits.trimStart('0').ifEmpty { "0" }
        if (d.length <= 3) return d
        var rest = d.dropLast(3)
        val parts = mutableListOf<String>()
        while (rest.length > 2) { parts.add(0, rest.takeLast(2)); rest = rest.dropLast(2) }
        if (rest.isNotEmpty()) parts.add(0, rest)
        return parts.joinToString(",") + "," + d.takeLast(3)
    }
}
