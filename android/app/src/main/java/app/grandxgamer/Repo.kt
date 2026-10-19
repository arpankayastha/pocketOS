package app.grandxgamer

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

// Payments read while the phone was offline wait in a queue; this sends them once it's online again.
class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val q = Store.queue(applicationContext)
        val left = JSONArray()
        var retry = false
        for (i in 0 until q.length()) {
            val entry = q.getJSONObject(i)
            if (retry) { left.put(entry); continue }
            try {
                Api.call(applicationContext, JSONObject(entry.toString()))
            } catch (e: IOException) {
                retry = true; left.put(entry)
            } catch (e: ApiError) {
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
