package app.echopdo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

// Wordings are the usual shapes of GPay / Paytm payment notifications; every name and amount is made up.
// The app's UPI log shows real ones, so a missed wording can be added here.
class UpiParserTest {
    private val gpay = "com.google.android.apps.nbu.paisa.user"
    private val paytm = "net.one97.paytm"

    @Test fun gpayPaid() {
        val n = UpiParser.parse(gpay, "Payment successful", "₹250 paid to Demo Stores")!!
        assertEquals("out", n.direction); assertEquals(250.0, n.amount, 0.0); assertEquals("Demo Stores", n.name); assertEquals("GPay", n.app)
    }

    @Test fun gpayYouPaid() {
        val n = UpiParser.parse(gpay, "You paid ₹1,250.50", "to Demo Person on 12 Oct")!!
        assertEquals("out", n.direction); assertEquals(1250.5, n.amount, 0.0); assertEquals("Demo Person", n.name)
    }

    @Test fun gpayReceived() {
        val n = UpiParser.parse(gpay, "Google Pay", "Demo Person paid you ₹500")!!
        assertEquals("in", n.direction); assertEquals(500.0, n.amount, 0.0); assertEquals("Demo Person", n.name)
    }

    @Test fun gpaySentYou() {
        val n = UpiParser.parse(gpay, "Demo Person sent you ₹75", null)!!
        assertEquals("in", n.direction); assertEquals("Demo Person", n.name)
    }

    @Test fun paytmPaid() {
        val n = UpiParser.parse(paytm, "Paid ₹1,250 to Demo Mart", "UPI Ref 123456789012")!!
        assertEquals("out", n.direction); assertEquals(1250.0, n.amount, 0.0); assertEquals("Demo Mart", n.name); assertEquals("Paytm", n.app)
    }

    @Test fun paytmReceived() {
        val n = UpiParser.parse(paytm, "₹100 received", "from Demo Person")!!
        assertEquals("in", n.direction); assertEquals(100.0, n.amount, 0.0); assertEquals("Demo Person", n.name)
    }

    @Test fun paytmMoneySentTitleAndText() {
        val n = UpiParser.parse(paytm, "Money Sent", "Rs. 30 sent to Demo Chai Stall")!!
        assertEquals("out", n.direction); assertEquals(30.0, n.amount, 0.0); assertEquals("Demo Chai Stall", n.name)
    }

    @Test fun amountWithoutAName() {
        val n = UpiParser.parse(gpay, "Payment successful", "₹90 paid")!!
        assertEquals("out", n.direction); assertNull(n.name)
    }

    @Test fun notPaymentsAreIgnored() {
        assertNull(UpiParser.parse(gpay, "Payment failed", "₹250 to Demo Stores could not be paid"))
        assertNull(UpiParser.parse(gpay, "Reminder", "Pay ₹300 to Demo Person"))
        assertNull(UpiParser.parse(gpay, "Win up to ₹1,000 cashback", "Pay your bills with Google Pay"))
        assertNull(UpiParser.parse(paytm, "Demo Person requested ₹200", "Tap to pay"))
        assertNull(UpiParser.parse(gpay, "Google Pay", "You have a new offer"))
        assertNull(UpiParser.parse("com.other.app", "Payment successful", "₹250 paid to Demo Stores"))
    }

    @Test fun namesAreTidy() {
        assertEquals("Demo Stores", UpiParser.parse(gpay, "Payment successful", "₹250 paid to Demo Stores.")!!.name)
        assertEquals("Demo Stores", UpiParser.parse(gpay, "Payment successful", "₹250 paid to Demo Stores on 12 Oct via UPI")!!.name)
        assertNotNull(UpiParser.appFor(gpay)); assertNull(UpiParser.appFor("x"))
    }

    // Paytm's Pocket Money notices say "spent" and "made a payment", with the payer's number and no payee name.
    @Test fun paytmPocketMoneySpent() {
        val n = UpiParser.parse(paytm, "₹40 spent using Pocket Money", "9000000001 made a payment using Pocket Money. Tap to see details.")!!
        assertEquals("out", n.direction); assertEquals(40.0, n.amount, 0.0); assertNull(n.name); assertEquals("Paytm", n.app)
    }

    @Test fun paytmPocketMoneyBiggerAmount() {
        val n = UpiParser.parse(paytm, "₹1,250 spent using Pocket Money", "9000000001 made a payment using Pocket Money. Tap to see details.")!!
        assertEquals(1250.0, n.amount, 0.0)
    }
}
