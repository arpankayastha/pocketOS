package app.echopdo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CalcTest {
    @Test fun evaluates() {
        assertEquals(165.0, Calc.evaluate("120+45")!!, 0.0)
        assertEquals(110.0, Calc.evaluate("20+30×3")!!, 0.0)
        assertEquals(75.5, Calc.evaluate("100−24.5")!!, 0.0)
        assertEquals(12.0, Calc.evaluate("12")!!, 0.0)
        assertNull(Calc.evaluate("12+"))
        assertNull(Calc.evaluate(""))
    }

    @Test fun formatsRupees() {
        // Android (ICU) groups as ₹1,25,000; the plain JVM as ₹125,000.
        assert(Calc.money(125000.0) in listOf("₹1,25,000", "₹125,000"))
        assertEquals("₹12.50", Calc.money(12.5))
    }
}
