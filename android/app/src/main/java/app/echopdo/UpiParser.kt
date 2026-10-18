package app.echopdo

import java.util.Locale

/** One UPI payment read from a GPay / Paytm notification. Only these fields are kept. */
data class UpiNotice(
    val direction: String,   // "out" (you paid) | "in" (you received)
    val amount: Double,
    val name: String?,       // the other side's name as the app shows it
    val app: String,         // "GPay" | "Paytm"
)

// Reads the notifications GPay and Paytm post after a payment, on the phone. Wording differs by
// app and version, so it's matched loosely: an amount (₹ / Rs), a paid / received word and a
// name after "to" / "from". Reminders, offers, requests and failures are ignored. The UPI log in
// the app shows what was read, so a missed wording can be reported and added here.
object UpiParser {
    val APPS = mapOf(
        "com.google.android.apps.nbu.paisa.user" to "GPay",
        "net.one97.paytm" to "Paytm",
    )

    private val SKIP = Regex(
        "(?i)\\b(failed|declined|unsuccessful|pending|reminder|remind|requested|requests?|request money|collect|" +
            "offers?|cashback|reward|scratch|win|earn|coupon|deadline|due|expires?|expiring|autopay|mandate|" +
            "otp|verification|refund (initiated|in progress)|will be (debited|credited))\\b"
    )
    private val AMOUNT = Regex("(?i)(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")
    // "X paid you ₹5" / "X sent you ₹5" / "received ₹5 from X" / "₹5 received".
    private val IN_WORDS = Regex("(?i)\\b(paid you|sent you|received|credited|money received|payment received|added to)\\b")
    private val OUT_WORDS = Regex("(?i)\\b(you paid|paid|sent|payment (of )?successful|payment successful|debited|money sent|transferred)\\b")
    private val NAME_AFTER_TO = Regex("(?i)\\b(?:paid|sent|payment)?\\s*(?:to|for)\\s+([^\\n]+?)(?=\\s+(?:on|via|using|from|at|with|ref|upi|successful|\\.|,|$)|[.,]|$)")
    private val NAME_AFTER_FROM = Regex("(?i)\\bfrom\\s+([^\\n]+?)(?=\\s+(?:on|via|using|to|at|with|ref|upi|\\.|,|$)|[.,]|$)")
    private val NAME_BEFORE_PAID_YOU = Regex("(?i)^\\s*([^\\n]+?)\\s+(?:paid|sent)\\s+you\\b")

    fun appFor(pkg: String?): String? = APPS[pkg]

    /** [title] and [text] as the notification shows them. Null if it isn't a completed payment. */
    fun parse(pkg: String?, title: String?, text: String?): UpiNotice? {
        val app = appFor(pkg) ?: return null
        val t = (title ?: "").replace(Regex("\\s+"), " ").trim()
        val x = (text ?: "").replace(Regex("\\s+"), " ").trim()
        val full = listOf(t, x).filter { it.isNotEmpty() }.joinToString(" · ")
        if (full.isEmpty() || SKIP.containsMatchIn(full)) return null
        val amount = AMOUNT.find(full)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()?.takeIf { it > 0 } ?: return null
        // "paid you / sent you" says money came in even though it also contains "paid" / "sent".
        val inward = IN_WORDS.containsMatchIn(full)
        val outward = OUT_WORDS.containsMatchIn(full.replace(Regex("(?i)\\b(paid|sent) you\\b"), ""))
        val direction = when {
            inward && !outward -> "in"
            outward && !inward -> "out"
            inward -> if (Regex("(?i)\\bfrom\\b").containsMatchIn(full) && !Regex("(?i)\\bto\\b").containsMatchIn(full)) "in" else return null
            else -> return null
        }
        val name = nameOf(direction, t, x, full)
        return UpiNotice(direction, amount, name, app)
    }

    private fun nameOf(direction: String, title: String, text: String, full: String): String? {
        val candidates = listOf(text, title, full)
        val found = when (direction) {
            "in" -> candidates.firstNotNullOfOrNull { NAME_BEFORE_PAID_YOU.find(it)?.groupValues?.get(1) }
                ?: candidates.firstNotNullOfOrNull { NAME_AFTER_FROM.find(it)?.groupValues?.get(1) }
            else -> candidates.firstNotNullOfOrNull { NAME_AFTER_TO.find(it)?.groupValues?.get(1) }
        }
        return found?.let { clean(it) }
    }

    private fun clean(raw: String): String? {
        var n = raw.replace(Regex("(?i)^(?:the\\s+)?(?:your\\s+)?"), "").trim().trim('.', ',', ':', '-', '·', '!', '"')
        n = n.replace(Regex("(?i)\\s+(?:successfully|successful)$"), "").trim()
        if (n.length < 2 || n.length > 60) return null
        if (AMOUNT.containsMatchIn(n) || n.all { it.isDigit() || it == ' ' }) return null
        if (n.lowercase(Locale.ROOT) in setOf("you", "your account", "bank account", "upi", "wallet", "paytm", "google pay", "gpay")) return null
        return n
    }
}
