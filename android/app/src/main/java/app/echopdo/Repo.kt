package app.echopdo

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

sealed class SaveResult {
    data class Saved(val id: String, val target: String) : SaveResult()
    object Queued : SaveResult()
    data class Failed(val message: String, val unpaired: Boolean = false) : SaveResult()
}

// Saving an entry: straight to the server, or into the offline queue when there's no network.
object Repo {
    /** Blocking — call off the main thread. */
    fun save(ctx: Context, entry: JSONObject): SaveResult {
        val body = JSONObject(entry.toString()).put("action", "add")
        return try {
            val res = Api.call(ctx, body)
            SaveResult.Saved(res.optString("id"), res.optString("target", entry.optString("target")))
        } catch (e: ApiError) {
            SaveResult.Failed(e.message ?: "Could not save.", e.unpaired)
        } catch (e: IOException) {
            Store.enqueue(ctx, entry)
            SyncWorker.schedule(ctx)
            SaveResult.Queued
        }
    }

    /** Blocking. */
    fun undo(ctx: Context, target: String, id: String): String? = try {
        Api.call(ctx, JSONObject().put("action", "undo").put("target", target).put("id", id)); null
    } catch (e: ApiError) { e.message } catch (e: IOException) { "No internet — try again." }
}

// Sends queued entries once the phone is online again.
class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val q = Store.queue(applicationContext)
        val left = JSONArray()
        var retry = false
        for (i in 0 until q.length()) {
            val entry = q.getJSONObject(i)
            if (retry) { left.put(entry); continue }
            try {
                val body = JSONObject(entry.toString())
                if (!body.has("action")) body.put("action", "add") // queued captures carry "capture"
                Api.call(applicationContext, body)
            } catch (e: IOException) {
                retry = true; left.put(entry)
            } catch (e: ApiError) {
                Notify.failed(applicationContext, entry, e.message ?: "Could not save.")
                if (e.unpaired) return Result.success()
            }
        }
        Store.setQueue(applicationContext, left)
        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        fun schedule(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            runCatching { WorkManager.getInstance(ctx).enqueueUniqueWork("sync", ExistingWorkPolicy.KEEP, req) }
        }
    }
}
