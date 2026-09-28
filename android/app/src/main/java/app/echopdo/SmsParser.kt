package app.echopdo

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One bank transaction read from an SMS. Nothing else from the message is kept. */
data class BankTxn(
    val direction: String,      // "out" (debited) | "in" (credited)
    val amount: Double,
    val date: LocalDate?,       // from the message; null → use the SMS time
    val accountHint: String?,   // last digits of the account / card, e.g. "1234"
    val card: Boolean,          // credit card (Hisab source "Card") vs bank account ("UPI")
    val payee: String?,         // VPA or name of the other side
    val ref: String?,           // UPI / bank reference, used to avoid duplicates
    val bank: String,
)

// Reads Indian bank transaction SMS on the phone. Formats are matched loosely (amount,
// Dr/Cr words, account digits, payee, reference) so small wording changes still work.
// OTPs, offers, reminders and "will be debited" notices are ignored.
object SmsParser {
    private val SKIP = Regex(
        "(?i)\\bOTP\\b|one[- ]time password|verification code|will be debited|is due|due on|due date|minimum amount|" +
            "request(ed)? (money|payment)|collect request|has requested|mandate|autopay (set|registered|created)|" +
            "offer|cashback|reward points?|pre-?approved|loan|failed|declined|reversed|refund initiated"
    )
    private val AMOUNT = Regex("(?i)(?:rs\\.?|inr|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")
    private val DEBIT = Regex("(?i)\\b(debited|dr\\.?|spent|paid|sent|withdrawn|purchase)\\b")
    private val CREDIT = Regex("(?i)\\b(credited|cr\\.?|received|deposited)\\b")

    /** True for DLT sender ids of banks, e.g. "JK-BOBSMS-S", "AD-FEDBNK-T", "JD-ICICIT-S". */
    fun fromBank(sender: String?): Boolean {
        val s = sender?.uppercase(Locale.ROOT) ?: return false
        return Regex("^[A-Z]{2}-[A-Z0-9]{3,8}(-[A-Z])?$").matches(s) &&
            Regex("BOB|BARODA|FEDBNK|FEDERAL|ICICI|HDFC|SBI|AXIS|KOTAK|YES|IDFC|PNB|CANARA|UNION|INDUS|BOI|AUBANK|RBL|PAYTM|PYTM|SLICE|ONECARD|CITI|AMEX|SCB|DBS|HSBC|KVB|SIB|IDBI|BANK|BNK|CARD").containsMatchIn(s)
    }

    fun bankName(sender: String?): String {
        val s = sender?.uppercase(Locale.ROOT).orEmpty()
        return when {
            "BOB" in s || "BARODA" in s -> "Bank of Baroda"
            "FED" in s -> "Federal Bank"
            "ICICI" in s -> "ICICI"
            "HDFC" in s -> "HDFC"
            "SBI" in s -> "SBI"
            "AXIS" in s -> "Axis"
            "KOTAK" in s -> "Kotak"
            else -> s.substringAfter('-').substringBefore('-').ifEmpty { "Bank" }
        }
    }

    fun parse(sender: String?, body: String): BankTxn? {
        val text = body.replace(Regex("\\s+"), " ").trim()
        if (SKIP.containsMatchIn(text)) return null
        val bank = bankName(sender)
        return icici(text) ?: bob(text) ?: federal(text) ?: kotak(text) ?: generic(text, bank)
    }

    // ----- Known formats -----

    // "ICICI Bank Credit Card XX4321 debited for INR 1,050.00 on 26-Sep-26 for UPI-614800000004-Merchant. To dispute…"
    // "ICICI Bank Acct XX987 debited for Rs 900.00 on 20-Sep-26; SOME NAME credited. UPI:614400000005. Call…"
    // "Dear Customer, Acct XX987 is credited with Rs 200.00 on 22-Sep-26 from SOME NAME. UPI:216200000006-ICICI Bank."
    private fun icici(t: String): BankTxn? {
        Regex("(?i)Credit Card XX(\\d{3,4}) debited for (?:INR|Rs\\.?) ?([0-9,]+(?:\\.\\d+)?) on (\\d{1,2}-[A-Za-z]{3}-\\d{2,4}) for (.+?)\\. To dispute").find(t)?.let { m ->
            val (card, amt, date, what) = m.destructured
            val upi = Regex("(?i)^UPI-(\\d{6,})-(.+)$").find(what.trim())
            return BankTxn("out", money(amt), dmy(date), card, true, (upi?.groupValues?.get(2) ?: what).trim(), upi?.groupValues?.get(1), "ICICI")
        }
        Regex("(?i)Acct XX(\\d{3,4}) debited for (?:INR|Rs\\.?) ?([0-9,]+(?:\\.\\d+)?) on (\\d{1,2}-[A-Za-z]{3}-\\d{2,4}); (.+?) credited\\. UPI:(\\d+)").find(t)?.let { m ->
            val (acct, amt, date, who, ref) = m.destructured
            return BankTxn("out", money(amt), dmy(date), acct, false, who.trim(), ref, "ICICI")
        }
        Regex("(?i)Acct XX(\\d{3,4}) is credited with (?:INR|Rs\\.?) ?([0-9,]+(?:\\.\\d+)?) on (\\d{1,2}-[A-Za-z]{3}-\\d{2,4}) from (.+?)\\. UPI:(\\d+)").find(t)?.let { m ->
            val (acct, amt, date, who, ref) = m.destructured
            return BankTxn("in", money(amt), dmy(date), acct, false, who.trim(), ref, "ICICI")
        }
        return null
    }

    // "Rs.3576.00 Dr. from A/C XXXXXX1234 and Cr. to someone@ptyes. Ref:111122223333. AvlBal:Rs…(2026:09:09 12:34:56). Not you?…"
    // (and the mirror "Rs.500.00 Cr. to A/C XXXXXX1234 and Dr. from someone@okaxis. Ref:…")
    private fun bob(t: String): BankTxn? {
        Regex("(?i)Rs\\.? ?([0-9,]+(?:\\.\\d+)?) Dr\\.? from A/C X*(\\d{3,6}) and Cr\\.? to (.+?)\\. Ref:? ?(\\d+)").find(t)?.let { m ->
            val (amt, acct, to, ref) = m.destructured
            return BankTxn("out", money(amt), bobDate(t), acct.takeLast(4), false, to.trim(), ref, "Bank of Baroda")
        }
        Regex("(?i)Rs\\.? ?([0-9,]+(?:\\.\\d+)?) Cr\\.? to A/C X*(\\d{3,6}) (?:and|&) Dr\\.? from (.+?)\\. Ref:? ?(\\d+)").find(t)?.let { m ->
            val (amt, acct, from, ref) = m.destructured
            return BankTxn("in", money(amt), bobDate(t), acct.takeLast(4), false, from.trim(), ref, "Bank of Baroda")
        }
        return null
    }

    // "Debited Rs 145.00 from a/c X5678 on 23Aug26 19:54 via UPI to Some Shop. Ref 623500000001.Bal Rs 99.25. Not you?…-Federal Bank"
    // "Rs 500.00 credited to your a/c X5678 on 23Aug26 via UPI from SOME NAME. Ref …" (credit, looser)
    private fun federal(t: String): BankTxn? {
        Regex("(?i)Debited Rs\\.? ?([0-9,]+(?:\\.\\d+)?) from a/c X*(\\d{3,6}) on (\\d{1,2}[A-Za-z]{3}\\d{2})(?: [0-9:]+)? via (?:UPI )?to (.+?)\\.? Ref:? ?(\\d+)").find(t)?.let { m ->
            val (amt, acct, date, to, ref) = m.destructured
            return BankTxn("out", money(amt), dMonY(date), acct.takeLast(4), false, cleanPayee(to), ref, "Federal Bank")
        }
        Regex("(?i)(?:Credited )?Rs\\.? ?([0-9,]+(?:\\.\\d+)?) (?:credited )?(?:to|in) (?:your )?a/c X*(\\d{3,6}) on (\\d{1,2}[A-Za-z]{3}\\d{2})(?: [0-9:]+)?(?: via UPI)? from (.+?)\\.? Ref:? ?(\\d+)").find(t)?.let { m ->
            val (amt, acct, date, from, ref) = m.destructured
            return BankTxn("in", money(amt), dMonY(date), acct.takeLast(4), false, cleanPayee(from), ref, "Federal Bank")
        }
        return null
    }

    // "INR 151 spent on Kotak Credit Card x7777 on 25-09-26 at UPI-K-216400000000-SHOP. Avl limit INR …"
    // "Sent Rs.40.00 from Kotak Bank A/c X8888 to Some Name on 27-09-26. UPI Ref 627000000000. Not done by you?…"
    // "Sent Rs.30.00 from Kotak Bank AC X8888 to 9000000000-2@ibl on 24-07-26.UPI Ref 620500000000. Not you,…"
    // "Received Rs.5000.00 in your Kotak Bank AC 8888 from SOME NAME on 26-08-26.UPI Ref:623800000000"
    private fun kotak(t: String): BankTxn? {
        Regex("(?i)(?:INR|Rs\\.?) ?([0-9,]+(?:\\.\\d+)?) spent on Kotak Credit Card x(\\d{3,4}) on (\\d{1,2}-\\d{1,2}-\\d{2,4}) at (.+?)\\. Avl").find(t)?.let { m ->
            val (amt, card, date, what) = m.destructured
            val upi = Regex("(?i)^UPI-(?:[A-Z]-)?(\\d{6,})-(.+)$").find(what.trim())
            return BankTxn("out", money(amt), dmyNum(date), card, true, (upi?.groupValues?.get(2) ?: what).trim(), upi?.groupValues?.get(1), "Kotak")
        }
        Regex("(?i)Sent Rs\\.? ?([0-9,]+(?:\\.\\d+)?) from Kotak Bank A/?C X*(\\d{3,6}) to (.+?) on (\\d{1,2}-\\d{1,2}-\\d{2,4})\\. ?UPI Ref:? ?(\\d+)").find(t)?.let { m ->
            val (amt, acct, to, date, ref) = m.destructured
            return BankTxn("out", money(amt), dmyNum(date), acct.takeLast(4), false, to.trim(), ref, "Kotak")
        }
        Regex("(?i)Received Rs\\.? ?([0-9,]+(?:\\.\\d+)?) in your Kotak Bank A/?C X*(\\d{3,6}) from (.+?) on (\\d{1,2}-\\d{1,2}-\\d{2,4})\\. ?UPI Ref:? ?(\\d+)").find(t)?.let { m ->
            val (amt, acct, from, date, ref) = m.destructured
            return BankTxn("in", money(amt), dmyNum(date), acct.takeLast(4), false, from.trim(), ref, "Kotak")
        }
        return null
    }

    // ----- Anything else that clearly says an amount was debited / credited -----
    private fun generic(t: String, bank: String): BankTxn? {
        val amt = AMOUNT.find(t) ?: return null
        val debit = DEBIT.find(t)
        val credit = CREDIT.find(t)
        val direction = when {
            debit != null && (credit == null || debit.range.first < credit.range.first) -> "out"
            credit != null -> "in"
            else -> return null
        }
        val card = Regex("(?i)credit card|card (ending|no\\.?)?\\s*(xx|x|\\*)").containsMatchIn(t)
        val acct = Regex("(?i)(?:a/c|acct|account|card)(?: no\\.?| ending| ending with)?\\s*(?:[Xx*]+)(\\d{3,6})").find(t)?.groupValues?.get(1)?.takeLast(4)
        val ref = Regex("(?i)(?:UPI[: -]|Ref(?:erence)?(?: No\\.?)?[: ]*|RRN[: ]*|txn(?: id)?[: ]*)(\\d{8,})").find(t)?.groupValues?.get(1)
        val vpa = Regex("[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}").find(t)?.value
        val name = vpa ?: Regex("(?i)(?:to|at|from|towards|for) ([A-Z][A-Za-z0-9 &.'-]{2,40}?)(?:\\.| on | Ref| UPI|;|$)").find(t)?.groupValues?.get(1)?.trim()
        val date = Regex("(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})").find(t)?.let { dmy(it.value) }
            ?: Regex("(\\d{1,2}[A-Za-z]{3}\\d{2})").find(t)?.let { dMonY(it.value) }
            ?: Regex("\\b(\\d{4})-(\\d{2})-(\\d{2})\\b").find(t)?.let { m ->
                runCatching { LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) }.getOrNull()
            }
            ?: Regex("\\b(\\d{1,2})[-/](\\d{1,2})[-/](\\d{2,4})\\b").find(t)?.let { m ->
                runCatching { LocalDate.of(year(m.groupValues[3]), m.groupValues[2].toInt(), m.groupValues[1].toInt()) }.getOrNull()
            }
        return BankTxn(direction, money(amt.groupValues[1]), date, acct, card, name, ref, bank)
    }

    // ----- helpers -----
    private fun money(s: String) = s.replace(",", "").toDouble()
    private fun cleanPayee(s: String) = s.trim().trimEnd('.').trim().takeUnless { Regex("^X+$").matches(it) } ?: "UPI"
    private fun year(y: String) = y.toInt().let { if (it < 100) 2000 + it else it }

    private fun dmy(s: String): LocalDate? = runCatching {   // 26-Sep-26 / 26-Sep-2026
        val p = s.split('-')
        LocalDate.of(year(p[2]), month(p[1]), p[0].toInt())
    }.getOrNull()

    private fun dmyNum(s: String): LocalDate? = runCatching { // 25-09-26
        val p = s.split('-')
        LocalDate.of(year(p[2]), p[1].toInt(), p[0].toInt())
    }.getOrNull()

    private fun dMonY(s: String): LocalDate? = runCatching { // 23Aug26
        val m = Regex("(\\d{1,2})([A-Za-z]{3})(\\d{2})").find(s)!!
        LocalDate.of(year(m.groupValues[3]), month(m.groupValues[2]), m.groupValues[1].toInt())
    }.getOrNull()

    private fun bobDate(t: String): LocalDate? = Regex("\\((\\d{4}):(\\d{2}):(\\d{2}) ").find(t)?.let { m ->
        runCatching { LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) }.getOrNull()
    }

    private fun month(m: String) = DateTimeFormatter.ofPattern("MMM", Locale.ENGLISH)
        .parse(m.lowercase(Locale.ROOT).replaceFirstChar { it.titlecase(Locale.ROOT) }).get(java.time.temporal.ChronoField.MONTH_OF_YEAR)
}
