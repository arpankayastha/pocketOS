package app.echopdo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

// Formats copied from real bank SMS; every name, VPA, account and reference is made up.
class SmsParserTest {
    private fun p(sender: String, body: String) = SmsParser.parse(sender, body)!!

    @Test fun bankOfBarodaDebit() {
        val t = p("JK-BOBSMS-S", "Rs.3576.00 Dr. from A/C XXXXXX1234 and Cr. to someone.demo@ptyes. Ref:111122223333. AvlBal:Rs10000.00(2026:09:09 12:34:56). Not you? Call 18005700/5000-BOB")
        assertEquals("out", t.direction); assertEquals(3576.0, t.amount, 0.0)
        assertEquals("1234", t.accountHint); assertEquals("someone.demo@ptyes", t.payee)
        assertEquals("111122223333", t.ref); assertEquals(LocalDate.of(2026, 9, 9), t.date)
        assertFalse(t.card); assertEquals("Bank of Baroda", t.bank)
    }

    @Test fun bankOfBarodaPhoneVpa() {
        val t = p("JK-BOBSMS-S", "Rs.270.00 Dr. from A/C XXXXXX1234 and Cr. to 9000000001@okbizaxis. Ref:444455556666. AvlBal:Rs900.00(2026:09:26 07:52:22). Not you? Call 18005700/5000-BOB")
        assertEquals(270.0, t.amount, 0.0); assertEquals("9000000001@okbizaxis", t.payee); assertEquals(LocalDate.of(2026, 9, 26), t.date)
    }

    @Test fun federalDebits() {
        val a = p("AD-FEDBNK-T", "Debited Rs 145.00 from a/c X5678 on 23Aug26 19:54 via UPI to XXXXXXXXXXXX. Ref 623500000001.Bal Rs 99.25. Not you? Call 18004251199 -Federal Bank")
        assertEquals("out", a.direction); assertEquals(145.0, a.amount, 0.0); assertEquals("5678", a.accountHint)
        assertEquals("UPI", a.payee); assertEquals("623500000001", a.ref); assertEquals(LocalDate.of(2026, 8, 23), a.date)
        val b = p("AD-FEDBNK-T", "Debited Rs 19.40 from a/c X5678 on 24Aug26 17:51 via UPI to Indian Railw. Ref 660200000002.Bal Rs 19.85. Not you?Call 18004251199 -Federal Bank")
        assertEquals("Indian Railw", b.payee); assertEquals(19.4, b.amount, 0.0)
        val c = p("AD-FEDBNK-T", "Debited Rs 270.00 from a/c X5678 on 23Sep26 19:53 via UPI to DEMO STORE D. Ref 315300000003.Bal Rs 342.77. Not you?Call 18004251199 -Federal Bank")
        assertEquals("DEMO STORE D", c.payee); assertEquals(LocalDate.of(2026, 9, 23), c.date)
    }

    @Test fun iciciCreditCard() {
        val t = p("JD-ICICIT-S", "ICICI Bank Credit Card XX4321 debited for INR 1,050.00 on 26-Sep-26 for UPI-614800000004-Demo Stores. To dispute call 18001080/SMS BLOCK 4321 to 9215676766")
        assertEquals("out", t.direction); assertEquals(1050.0, t.amount, 0.0); assertEquals("4321", t.accountHint)
        assertTrue(t.card); assertEquals("Demo Stores", t.payee); assertEquals("614800000004", t.ref)
        assertEquals(LocalDate.of(2026, 9, 26), t.date); assertEquals("ICICI", t.bank)
    }

    @Test fun iciciAccountDebitAndCredit() {
        val d = p("AX-ICICIT-S", "ICICI Bank Acct XX987 debited for Rs 900.00 on 20-Sep-26; DEMO PERSON credited. UPI:614400000005. Call 18002662 for dispute. SMS BLOCK 987 to 9215676766.")
        assertEquals("out", d.direction); assertEquals(900.0, d.amount, 0.0); assertEquals("987", d.accountHint)
        assertEquals("DEMO PERSON", d.payee); assertEquals("614400000005", d.ref); assertFalse(d.card)
        val c = p("AX-ICICIT-S", "Dear Customer, Acct XX987 is credited with Rs 200.00 on 22-Sep-26 from DEMO SENDER. UPI:216200000006-ICICI Bank.")
        assertEquals("in", c.direction); assertEquals(200.0, c.amount, 0.0); assertEquals("DEMO SENDER", c.payee)
        assertEquals("216200000006", c.ref); assertEquals(LocalDate.of(2026, 9, 22), c.date)
    }

    @Test fun kotak() {
        val cc = p("AD-KOTAKB-S", "INR 151 spent on Kotak Credit Card x7777 on 25-09-26 at UPI-K-216400000007-DEMO. Avl limit INR 29770 Not you? SMS CCLOST 7777 to 5676788")
        assertEquals("out", cc.direction); assertEquals(151.0, cc.amount, 0.0); assertEquals("7777", cc.accountHint); assertTrue(cc.card)
        assertEquals("DEMO", cc.payee); assertEquals("216400000007", cc.ref); assertEquals(LocalDate.of(2026, 9, 25), cc.date)
        val sent = p("JD-KOTAKB-S", "Sent Rs.40.00 from Kotak Bank A/c X8888 to Demo Person Name on 27-09-26. UPI Ref 627000000008. Not done by you? Tap https://kotak.bank.in/KBANKT/Fraud")
        assertEquals("out", sent.direction); assertEquals(40.0, sent.amount, 0.0); assertEquals("8888", sent.accountHint)
        assertEquals("Demo Person Name", sent.payee); assertEquals("627000000008", sent.ref); assertEquals(LocalDate.of(2026, 9, 27), sent.date)
        val vpa = p("JD-KOTAKB-S", "Sent Rs.30.00 from Kotak Bank AC X8888 to 9000000002-2@ibl on 24-07-26.UPI Ref 620500000009. Not you, https://kotak.com/KBANKT/Fraud")
        assertEquals("9000000002-2@ibl", vpa.payee); assertEquals(LocalDate.of(2026, 7, 24), vpa.date)
        val rcv = p("JD-KOTAKB-S", "Received Rs.5000.00 in your Kotak Bank AC 8888 from DEMO SENDER NAME on 26-08-26.UPI Ref:623800000010")
        assertEquals("in", rcv.direction); assertEquals(5000.0, rcv.amount, 0.0); assertEquals("8888", rcv.accountHint)
        assertEquals("DEMO SENDER NAME", rcv.payee); assertEquals("623800000010", rcv.ref); assertEquals(LocalDate.of(2026, 8, 26), rcv.date)
    }

    @Test fun genericFallback() {
        val t = p("VM-HDFCBK", "Rs.499.00 spent on HDFC Bank Card x1111 at DEMO MART on 2026-09-20. Not you? Call 18002586161")
        assertEquals("out", t.direction); assertEquals(499.0, t.amount, 0.0); assertEquals("1111", t.accountHint); assertTrue(t.card); assertEquals(LocalDate.of(2026, 9, 20), t.date)
    }

    @Test fun ignoresNonTransactions() {
        assertNull(SmsParser.parse("AX-ICICIT-S", "123456 is the OTP for your transaction of INR 500.00 on ICICI Bank Credit Card XX4321. Do not share."))
        assertNull(SmsParser.parse("AX-ICICIT-S", "Payment of INR 5,000.00 on your ICICI Bank Credit Card XX4321 is due on 05-Oct-26."))
        assertNull(SmsParser.parse("JK-BOBSMS-S", "DEMO has requested money of Rs.100 from you on BHIM. Ignore if not known."))
        assertNull(SmsParser.parse("AD-FEDBNK-T", "Get a pre-approved loan up to Rs 5,00,000. Apply now."))
    }

    @Test fun senderFilter() {
        assertTrue(SmsParser.fromBank("JK-BOBSMS-S")); assertTrue(SmsParser.fromBank("AD-FEDBNK-T")); assertTrue(SmsParser.fromBank("JD-ICICIT-S"))
        assertFalse(SmsParser.fromBank("+919000000001")); assertFalse(SmsParser.fromBank("VM-SWIGGY")); assertFalse(SmsParser.fromBank(null))
    }
}
