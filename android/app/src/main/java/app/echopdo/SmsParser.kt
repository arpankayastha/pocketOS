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
    // Paying a credit card bill moves money, it isn't spending (each card purchase is already
    // counted): the card's "payment received" SMS and the bank's "paid towards credit card" one.
    private val CARD_BILL = Regex(
        "(?i)(payment|amount|rs\\.?|inr).{0,40}(has been )?received.{0,50}credit card|" +
            "(payment|amount|rs\\.?|inr).{0,40}received (for|on|in|to|towards) (your )?[a-z]*card\\b|" +
            "received.{0,40}towards.{0,30}(credit )?card|thank you for (the |your )?payment.{0,60}card|" +
            "credit card.{0,30}(bill|payment|dues?)\\b|card (bill|dues) (paid|payment)|towards.{0,30}credit card|" +
            "\\bbbps\\b.{0,80}credit card|credit card.{0,80}\\bbbps\\b|cred\\.club|@cred\\b|\\bcred club\\b"
    )
    fun isCardBillPayment(text: String) = CARD_BILL.containsMatchIn(text) && !Regex("(?i)refund|reversal").containsMatchIn(text)

    // The card issuer's side of a bill payment ("Payment of Rs X has been received on your … Credit Card
    // XX1234", "Thank you for your payment … card ending 1234"): read as a bill payment so that card's
    // bill in Plan is marked paid. The bank's side (money debited towards the card, CRED, BBPS from an
    // account) stays skipped — it's the same payment.
    private val BILL_RECEIVED = Regex("(?i)received|thank you for (the |your )?payment|payment.{0,20}(credited|posted|successful)")
    private val BILL_BANK_SIDE = Regex("(?i)debited|\\bdr\\b|cred\\.club|@cred\\b|\\bcred club\\b|trf to|transferred to|sent to|paid to")
    private val CARD_DIGITS = Regex("(?i)card\\b[^0-9]{0,30}?(?:xx|x+|\\*+|ending(?: in| with)?|no\\.?|number)?\\s*([0-9]{4})\\b")
    fun billPayment(sender: String?, body: String): BankTxn? {
        val text = body.replace(Regex("\\s+"), " ").trim()
        if (!isCardBillPayment(text) || !BILL_RECEIVED.containsMatchIn(text) || BILL_BANK_SIDE.containsMatchIn(text)) return null
        if (Regex("(?i)\\bOTP\\b|will be|is due|due on|due date|minimum amount").containsMatchIn(text)) return null
        val amount = AMOUNT.find(text)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()?.takeIf { it > 0 } ?: return null
        val digits = CARD_DIGITS.find(text)?.groupValues?.get(1) ?: return null
        return BankTxn("bill", amount, null, digits, true, null, null, bankName(sender))
    }
    private val AMOUNT = Regex("(?i)(?:rs\\.?|inr|₹)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")

    /** True for business (DLT) sender ids like "JK-BOBSMS-S", "AD-FEDBNK-T", "VM-HDFCBK" — any bank. */
    // Phones store these differently ("JK-BOBSMS-S", "JKBOBSMS", "BOBSMS"), so: any sender name
    // with letters that isn't a phone number. The message itself is checked strictly in parse().
    fun fromBank(sender: String?): Boolean {
        val s = sender?.uppercase(Locale.ROOT)?.trim() ?: return false
        if (Regex("^\\+?[0-9 ()-]{6,}$").matches(s)) return false
        return Regex("^[A-Z0-9-]{3,20}$").matches(s) && s.count { it.isLetter() } >= 3
    }

    // Header ids that are banks / cards / payment banks (a message from these may skip the
    // "must mention an account or card number" check).
    private val BANKISH = Regex("BOB|BARODA|FEDBNK|FEDRL|ICICI|HDFC|SBI|AXIS|KOTAK|YESB|IDFC|PNB|CANBNK|CANARA|UNION|INDUS|BOI|AUBANK|AUSFB|RBL|PAYTMB|PYTMB|SLICE|ONECRD|CITI|AMEX|SCBANK|DBS|HSBC|KVB|SIB|IDBI|IOB|CENTBK|UCO|IPB|AIRBNK|JIOPBK|FINO|EQUTAS|UJJIV|BANK|BNK|CARD")

    private val NAMES = listOf(
        "BOB|BARODA" to "Bank of Baroda", "FED" to "Federal Bank", "ICICI" to "ICICI", "HDFC" to "HDFC", "SBI" to "SBI",
        "AXIS" to "Axis", "KOTAK" to "Kotak", "YESB" to "Yes Bank", "IDFC" to "IDFC First", "PNB" to "PNB", "CANBNK|CANARA" to "Canara",
        "UNION" to "Union Bank", "INDUS" to "IndusInd", "BOIIND|BOISMS|^BOI" to "Bank of India", "AUBANK|AUSFB" to "AU Bank", "RBL" to "RBL",
        "PAYTM|PYTM" to "Paytm", "SLICE" to "Slice", "ONECRD" to "OneCard", "CITI" to "Citi", "AMEX" to "Amex", "SCB" to "Standard Chartered",
        "DBS" to "DBS", "HSBC" to "HSBC", "KVB" to "KVB", "SIB" to "South Indian Bank", "IDBI" to "IDBI", "IOB" to "IOB", "CENTBK" to "Central Bank",
        "UCO" to "UCO", "IPB" to "India Post", "AIRBNK" to "Airtel Payments", "JIOPB" to "Jio Payments", "EQUTAS" to "Equitas",
    )

    fun bankName(sender: String?): String {
        val parts = sender?.uppercase(Locale.ROOT)?.split('-').orEmpty()
        val id = (if (parts.size >= 2 && parts[0].length == 2) parts[1] else parts.maxByOrNull { it.length }).orEmpty()
        return NAMES.firstOrNull { (k, _) -> Regex(k).containsMatchIn(id) }?.second ?: id.ifEmpty { "Bank" }
    }

    fun parse(sender: String?, body: String): BankTxn? {
        val text = body.replace(Regex("\\s+"), " ").trim()
        if (SKIP.containsMatchIn(text) || isCardBillPayment(text)) return null
        val bank = bankName(sender)
        val bankish = BANKISH.containsMatchIn(sender?.uppercase(Locale.ROOT).orEmpty())
        return icici(text) ?: bob(text) ?: federal(text) ?: kotak(text) ?: generic(text, bank, bankish)
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

    // ----- Any other bank -----
    // Needs an amount, a debit/credit word and (unless the sender is clearly a bank) a masked
    // account or card number, so shop / app messages ("your order of Rs 250 is paid") are skipped.
    private val ACCT = listOf(
        Regex("(?i)\\b(?:account|acct|card|a/?c)[^0-9\\n]{0,20}?[xX*]+\\s?(\\d{3,6})"),   // A/c XX1234, Card *1234, A/cX4321
        Regex("(?i)\\b(?:ending|ends)\\s*(?:with|in)?\\s*[xX*]*(\\d{3,6})"),                        // card ending 1234
        Regex("(?i)\\b(?:card|a/?c|acct|account)\\s+(?:no\\.?\\s*)?(\\d{4})\\b"),                // Card 1234, a/c 3333
    )
    private val OUT_WORDS = Regex("(?i)\\b(debited|debit|dr|spent|paid|sent|withdrawn|withdrawal|purchase|transferred|deducted|charged|used)\\b")
    private val IN_WORDS = Regex("(?i)\\b(credited|cr|received|deposited|refunded|added)\\b")
    private val AMOUNT_WORD = Regex("(?i)(?:debited|credited|withdrawn|deposited)\\s+(?:by|with|for)\\s+(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.\\d{1,2})?)")
    private val NOT_AMOUNT = Regex("(?i)(bal|balance|limit|lmt|avl|available|outstanding|due|total)[^0-9]{0,6}$")
    private val REF = listOf(
        Regex("(?i)UPI[-/:](?:[A-Z]-|P2[AM]/)?(\\d{9,})"),
        Regex("(?i)(?:UPI\\s*Ref(?:\\s*No)?|IMPS\\s*Ref(?:\\s*No)?|Ref(?:erence)?(?:\\s*No\\.?)?|RRN|UTR(?:\\s*No)?|Txn\\s*(?:ID|No)?|Transaction\\s*ID)[\\s:#.-]*([A-Z0-9]*\\d{8,}[A-Z0-9]*)"),
    )
    private val PAYEE = listOf(
        Regex("(?i)UPI[-/](?:[A-Z]-)?\\d{6,}[-/]([^./]+?)(?:\\.|/|\\s+Not\\b|\\s+To\\b|$)"),          // UPI-4265…-NAME
        Regex("(?i)UPI/(?:P2[AM]|[A-Z]{2,4})/\\d{6,}/([^/.]+?)(?:/|\\s+Not\\b|\\.|$)"),                    // UPI/P2M/4265…/NAME
        Regex("(?i);\\s*([A-Za-z][A-Za-z0-9 &.'-]{1,40}?)\\s+credited"),                                    // ; NAME credited
        Regex("(?i)\\bon\\s+(?:\\d{1,2}[-/. ][A-Za-z0-9]{2,3}[-/. ]\\d{2,4}|\\d{1,2}[A-Za-z]{3}\\d{2})\\s+(?:on|at)\\s+([A-Za-z0-9*][A-Za-z0-9 &.'*/_-]{1,40}?)(?=\\.\\s|\\s+Avl|\\s+Not\\b|,|\\.$|$)"), // … on 25-Sep-26 on SHOP
        Regex("(?i)(?:\\b(?:trf to|towards|to|at|from|by)\\b|\\binfo[:-])\\s*(?!your\\b|a/?c\\b|ac\\b|acct\\b|account\\b|rs\\b|inr\\b|the\\b|\\d)([A-Za-z0-9][A-Za-z0-9 &.'/_-]{1,40}?)(?=\\s+on\\b|\\s+via\\b|\\.\\s|\\s+Ref|\\s+UPI|\\s+Avl|\\s+Bal|\\s+Not\\b|\\s+from\\b|\\s*\\(|;|,|\\.$|$)"),
    )

    private fun generic(t: String, bank: String, bankish: Boolean): BankTxn? {
        val acct = ACCT.firstNotNullOfOrNull { it.find(t)?.groupValues?.get(1) }?.takeLast(4)
        if (acct == null && !bankish) return null
        // "credit card" / "debit card" are not directions.
        val plain = t.replace(Regex("(?i)(credit|debit)\\s+card"), "card")
        val out = OUT_WORDS.find(plain); val inn = IN_WORDS.find(plain)
        val direction = when {
            out != null && (inn == null || out.range.first < inn.range.first) -> "out"
            inn != null -> "in"
            else -> return null
        }
        val amount = AMOUNT_WORD.find(t)?.groupValues?.get(1)
            ?: AMOUNT.findAll(t).firstOrNull { !NOT_AMOUNT.containsMatchIn(t.substring(maxOf(0, it.range.first - 24), it.range.first)) }?.groupValues?.get(1)
            ?: return null
        val card = Regex("(?i)\\bcard\\b").containsMatchIn(t)
        val ref = REF.firstNotNullOfOrNull { it.find(t)?.groupValues?.get(1) }
        val vpa = Regex("[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}").find(t)?.value
        val payee = (PAYEE.take(4).firstNotNullOfOrNull { it.find(t)?.groupValues?.get(1) } ?: vpa ?: PAYEE[4].find(t)?.groupValues?.get(1))
            ?.trim()?.trimEnd('.')?.trim()?.takeUnless { it.isEmpty() || Regex("^[Xx*\\d\\s]+$").matches(it) }
        return BankTxn(direction, money(amount), findDate(t), acct, card, payee, ref, bank)
    }

    private fun findDate(t: String): LocalDate? =
        Regex("(\\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\\d{2,4})\\b").find(t)?.let { m ->          // 26-Sep-26, 26 Sep 2026
            runCatching { LocalDate.of(year(m.groupValues[3]), month(m.groupValues[2]), m.groupValues[1].toInt()) }.getOrNull()
        }
            ?: Regex("\\b(\\d{1,2}[A-Za-z]{3}\\d{2})\\b").find(t)?.let { dMonY(it.value) }                  // 23Aug26
            ?: Regex("\\b(\\d{4})[-:/](\\d{2})[-:/](\\d{2})").find(t)?.let { m ->                                // 2026-09-21, 2026:09:09
                runCatching { LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) }.getOrNull()
            }
            ?: Regex("\\b(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})\\b").find(t)?.let { m ->                   // 20/09/26, 24-09-2026
                runCatching { LocalDate.of(year(m.groupValues[3]), m.groupValues[2].toInt(), m.groupValues[1].toInt()) }.getOrNull()
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
