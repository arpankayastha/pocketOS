package app.echopdo

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Runs only with ECHOPDO_TEST_CODE set to a fresh pairing code: pairs, reads the config,
// adds a Hisab entry and undoes it against the real server.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LiveApiTest {
    @Test fun pairAddUndo() {
        val code = System.getProperty("echopdo.testCode").orEmpty()
        assumeTrue(code.isNotEmpty())
        val ctx: Context = ApplicationProvider.getApplicationContext()
        Api.endpoint = "${BuildConfig.SUPABASE_URL}/functions/v1/quickadd"
        Store.unpair(ctx)
        val res = Api.call(ctx, JSONObject().put("action", "pair").put("code", code).put("name", "Robolectric"))
        Store.savePairing(ctx, res.getString("token"), res.optString("household"))
        val cfg = Api.refreshConfig(ctx)
        assertTrue(cfg.getJSONObject("hisab").getJSONArray("books").length() >= 1)
        val saved = Repo.save(ctx, JSONObject().put("target", "hisab").put("direction", "out").put("amount", 1.5).put("note", "zz-test"))
        assertTrue(saved.toString(), saved is SaveResult.Saved)
        assertNull(Repo.undo(ctx, "hisab", (saved as SaveResult.Saved).id))
        assertEquals("Too late to undo here — edit it in eChopdo.", Repo.undo(ctx, "hisab", saved.id))
    }
}
