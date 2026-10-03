package app.echopdo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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

    // ----- Any other bank (made-up messages in each bank's usual wording) -----
    @Test fun hdfcUpiAndCard() {
        val u = p("VM-HDFCBK", "Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo DEMO SHOP\nOn 20/09/26\nRef 426312345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808")
        assertEquals("out", u.direction); assertEquals(250.0, u.amount, 0.0); assertEquals("1234", u.accountHint)
        assertEquals("DEMO SHOP", u.payee); assertEquals("426312345678", u.ref); assertEquals(LocalDate.of(2026, 9, 20), u.date); assertEquals("HDFC", u.bank)
        val c = p("AD-HDFCBK", "Spent Rs.1499 On HDFC Bank Card 9876 At DEMO ELECTRONICS On 2026-09-21:18:22:10 Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 9876 to 7308080808")
        assertEquals("out", c.direction); assertEquals(1499.0, c.amount, 0.0); assertEquals("9876", c.accountHint); assertTrue(c.card)
        assertEquals("DEMO ELECTRONICS", c.payee); assertEquals(LocalDate.of(2026, 9, 21), c.date)
    }

    @Test fun sbiDebitAndCredit() {
        val d = p("AD-SBIUPI", "Dear UPI user A/C X4321 debited by 150.0 on date 22Sep26 trf to DEMO KIRANA Refno 426500000011. If not u? call 1800111109. -SBI")
        assertEquals("out", d.direction); assertEquals(150.0, d.amount, 0.0); assertEquals("4321", d.accountHint)
        assertEquals("DEMO KIRANA", d.payee); assertEquals("426500000011", d.ref); assertEquals(LocalDate.of(2026, 9, 22), d.date); assertEquals("SBI", d.bank)
        val c = p("JD-SBIINB", "Dear SBI UPI User, ur A/cX4321 credited by Rs500 on 23Sep26 by (Ref no 426600000012)")
        assertEquals("in", c.direction); assertEquals(500.0, c.amount, 0.0); assertEquals("4321", c.accountHint); assertEquals("426600000012", c.ref)
    }

    @Test fun axisIdfcAtmYesPaytm() {
        val a = p("VK-AXISBK", "Debit INR 2000.00 A/c no. XX5555 24-09-26, 10:15:01 UPI/P2M/426700000013/DEMO FOODS Not you? SMS BLOCKALL to 919951860002")
        assertEquals("out", a.direction); assertEquals(2000.0, a.amount, 0.0); assertEquals("5555", a.accountHint)
        assertEquals("DEMO FOODS", a.payee); assertEquals("426700000013", a.ref); assertEquals(LocalDate.of(2026, 9, 24), a.date); assertEquals("Axis", a.bank)
        val s = p("JM-IDFCFB", "Your A/C XXXXX6789 has been credited with INR 45,000.00 on 01/10/2026. Info: NEFT-DEMO EMPLOYER PVT LTD. Avl Bal: INR 60,000.00")
        assertEquals("in", s.direction); assertEquals(45000.0, s.amount, 0.0); assertEquals("6789", s.accountHint)
        assertEquals("NEFT-DEMO EMPLOYER PVT LTD", s.payee); assertEquals(LocalDate.of(2026, 10, 1), s.date)
        val atm = p("BZ-PNBSMS", "Rs 2000 withdrawn at ATM DEMO BRANCH from A/c XX1111 on 25-Sep-26. Avl bal Rs 5000")
        assertEquals("out", atm.direction); assertEquals(2000.0, atm.amount, 0.0); assertEquals("1111", atm.accountHint); assertEquals("ATM DEMO BRANCH", atm.payee)
        val y = p("AX-YESBNK", "INR 349.00 spent on YES BANK Credit Card XX2222 at DEMO OTT on 26-09-2026. Avl Lmt INR 90,000")
        assertEquals("out", y.direction); assertEquals(349.0, y.amount, 0.0); assertEquals("2222", y.accountHint); assertTrue(y.card); assertEquals("DEMO OTT", y.payee)
        val pt = p("BZ-PAYTMB", "Rs.99 sent to demo@paytm from Paytm Payments Bank a/c 3333. UPI Ref: 426800000014")
        assertEquals("out", pt.direction); assertEquals(99.0, pt.amount, 0.0); assertEquals("3333", pt.accountHint)
        assertEquals("demo@paytm", pt.payee); assertEquals("426800000014", pt.ref)
    }

    @Test fun iciciCardSpentUsingFormat() {
        val t = p("JD-ICICIT-S", "INR 768.00 spent using ICICI Bank Card XX1234 on 25-Sep-26 on IND*DEMO FUELS. Avl Limit: INR 1,00,000. If not you, call 1800 2662/SMS BLOCK 1234 to 9215676766")
        assertEquals("out", t.direction); assertEquals(768.0, t.amount, 0.0); assertEquals("1234", t.accountHint); assertTrue(t.card)
        assertEquals("IND*DEMO FUELS", t.payee); assertEquals(LocalDate.of(2026, 9, 25), t.date)
    }

    @Test fun balanceIsNotTheAmount() {
        val t = p("AD-CANBNK", "Avl Bal Rs 10,000.00. Rs 450.00 debited from a/c XX7777 on 27-09-26 towards DEMO MEDICAL. -Canara Bank")
        assertEquals(450.0, t.amount, 0.0); assertEquals("DEMO MEDICAL", t.payee)
    }

    @Test fun shopAndAppMessagesAreSkipped() {
        assertNull(SmsParser.parse("VM-SWIGGY", "Your order of Rs 250 is confirmed and paid via UPI. Track it in the app."))
        assertNull(SmsParser.parse("AD-AMAZON", "Refund of Rs 499 has been processed for your order. It will be credited in 3-5 days."))
        assertNull(SmsParser.parse("AD-HDFCBK", "Your a/c XX1234 balance is Rs 5000 as on 26-09-26."))
        assertNull(SmsParser.parse("AD-HDFCBK", "Rs 1500 will be debited from a/c XX1234 on 05-10-26 towards autopay DEMO."))
    }

    // The card's own "payment received" SMS marks that card's bill paid (made-up values).
    @Test fun cardBillPaymentReceivedIsReadAsBillPayment() {
        val icici = SmsParser.billPayment("AD-ICICIB-S", "Payment of Rs 12,345.67 has been received on your ICICI Bank Credit Card XX1234 through Bharat Bill Payment System on 08-SEP-26.")!!
        assertEquals("bill", icici.direction); assertEquals(12345.67, icici.amount, 0.001); assertEquals("1234", icici.accountHint); assertEquals("ICICI", icici.bank)
        val hdfc = SmsParser.billPayment("VM-HDFCBK", "Thank you for your payment of INR 5,000.00 towards your HDFC Bank Credit Card ending 4321.")!!
        assertEquals(5000.0, hdfc.amount, 0.001); assertEquals("4321", hdfc.accountHint)
        // The bank's side of the same payment, and ordinary spends, are not bill payments.
        assertNull(SmsParser.billPayment("AD-BOBSMS-S", "Rs.4000.00 debited from A/c XX1111 towards ICICI Credit Card bill payment via BBPS. Ref 123"))
        assertNull(SmsParser.billPayment("AD-SBIUPI-S", "Dear UPI user A/C X2222 debited by 3000.0 on date 08Sep26 trf to CRED Club Refno 400000000001."))
        assertNull(SmsParser.billPayment("AD-ICICIB-S", "INR 768.00 spent using ICICI Bank Card XX1234 on 25-Sep-26 on IND*DEMO FUELS. Avl Limit: INR 1,00,000."))
        assertNull(SmsParser.billPayment("AD-ICICIB-S", "Payment of Rs 5,000 is due on your ICICI Bank Credit Card XX1234 on 03-Oct-26."))
    }

    @Test fun creditCardBillPaymentsAreSkipped() {
        // Card side: the bill payment arriving on the card.
        assertNull(SmsParser.parse("AX-ICICIT-S", "Payment of Rs 12,345.67 has been received on your ICICI Bank Credit Card XX1234 through Bharat Bill Payment System on 08-SEP-26."))
        assertNull(SmsParser.parse("VM-HDFCBK", "Thank you for your payment of Rs 5,000.00 towards your HDFC Bank Credit Card ending 1234."))
        // Bank side: money leaving the account to pay the card.
        assertNull(SmsParser.parse("AD-SBIUPI", "Dear UPI user A/C X4321 debited by 5000.0 on date 08Sep26 trf to CRED Club Refno 426500000099. -SBI"))
        assertNull(SmsParser.parse("JK-BOBSMS-S", "Rs.5000.00 Dr. from A/C XXXXXX1234 and Cr. to demo.cc@cred.club. Ref:111122229999. AvlBal:Rs900.00(2026:09:08 10:00:00). Not you? Call 18005700/5000-BOB"))
        assertNull(SmsParser.parse("AD-HDFCBK", "Rs 5000 debited from a/c XX1234 on 08-09-26 towards ICICI Credit Card bill payment via BBPS."))
        // …but card purchases and card refunds still count.
        assertNotNull(SmsParser.parse("JD-ICICIT-S", "ICICI Bank Credit Card XX4321 debited for INR 70.00 on 08-Sep-26 for UPI-625100000011-DEMO. To dispute call 18001080/SMS BLOCK 4321 to 9215676766"))
        assertNotNull(SmsParser.parse("AD-HDFCBK", "Rs 499.00 credited to your HDFC Bank Credit Card XX1234 as refund from DEMO MART on 08-09-26."))
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
        assertTrue(SmsParser.fromBank("VM-HDFCBK")); assertTrue(SmsParser.fromBank("BZ-PAYTMB"))
        assertTrue(SmsParser.fromBank("JKBOBSMS")); assertTrue(SmsParser.fromBank("BOBSMS"))
        assertFalse(SmsParser.fromBank("+919000000001")); assertFalse(SmsParser.fromBank("90000 00001")); assertFalse(SmsParser.fromBank(null))
    }
}
