package app.echopdo

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

// The app isn't in the Play Store, so it updates itself (like Snaptube): every few hours it checks
// the download page, downloads a newer APK in the background, checks its SHA-256 (version.json) and
// that it is signed with the same key, and installs it with PackageInstaller. Android asks once
// ("Update eChopdo?") the first time; after that eChopdo is the installer of record and, on
// Android 12+, later updates install silently. The app restarts on its own (MY_PACKAGE_REPLACED).
object Updates {
    const val PAGE = "${BuildConfig.WEB_URL}/download/"
    private const val CHANNEL = "updates"
    private const val NID = 30_001
    const val INSTALLED = "app.echopdo.UPDATE_STATUS"

    fun available(ctx: Context) = Store.latestVersion(ctx) > BuildConfig.VERSION_CODE

    /** Blocking; returns true when a newer version exists. */
    fun check(ctx: Context, force: Boolean = false): Boolean {
        if (!force && System.currentTimeMillis() - Store.lastUpdateCheck(ctx) < 6 * 3600_000L) return available(ctx)
        runCatching {
            val json = JSONObject(fetch("${PAGE}version.json").decodeToString())
            Store.saveUpdateCheck(ctx, json.optInt("versionCode"), json.optString("versionName"), json.optString("sha256"))
        }
        return available(ctx)
    }

    private fun fetch(url: String): ByteArray {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000; conn.readTimeout = 60_000
        conn.setRequestProperty("Cache-Control", "no-cache")
        try { return conn.inputStream.use { it.readBytes() } } finally { conn.disconnect() }
    }

    /** Android's "Install unknown apps" switch for eChopdo (needed once for self-updates). */
    fun canInstall(ctx: Context) = ctx.packageManager.canRequestPackageInstalls()
    fun allowIntent(ctx: Context) = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Every 6 hours on any network; also run once now (e.g. when the app or sheet opens). */
    fun schedule(ctx: Context, now: Boolean = false) {
        val wm = runCatching { WorkManager.getInstance(ctx) }.getOrNull() ?: return
        val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        wm.enqueueUniquePeriodicWork("update", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS).setConstraints(net).build())
        if (now) wm.enqueueUniqueWork("update-now", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<UpdateWorker>().setConstraints(net).build())
    }

    /** Blocking. Downloads, verifies and starts installing a newer version, if there is one. */
    fun run(ctx: Context, force: Boolean = false) {
        if (!check(ctx, force)) return
        if (!canInstall(ctx)) { notify(ctx, "eChopdo ${Store.latestName(ctx)} is ready", "Tap to allow eChopdo to update itself",
            PendingIntent.getActivity(ctx, NID, allowIntent(ctx), PendingIntent.FLAG_IMMUTABLE)); return }
        val apk = File(ctx.cacheDir, "update.apk")
        val want = Store.latestSha(ctx)
        if (!apk.exists() || sha256(apk.readBytes()) != want) {
            val bytes = fetch("${PAGE}echopdo.apk?v=${Store.latestVersion(ctx)}")
            if (want.isNotEmpty() && sha256(bytes) != want) return // half-downloaded or mid-deploy; try next time
            apk.writeBytes(bytes)
        }
        if (!sameSigner(ctx, apk)) { apk.delete(); return }
        install(ctx, apk)
    }

    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** Only an APK of this app, newer, and signed with our own key. */
    @Suppress("DEPRECATION")
    private fun sameSigner(ctx: Context, apk: File): Boolean {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(apk.path, flags) ?: return false
        if (archive.packageName != ctx.packageName || PackageInfoCompat.getLongVersionCode(archive) <= BuildConfig.VERSION_CODE) return false
        val mine = pm.getPackageInfo(ctx.packageName, flags)
        fun certs(p: android.content.pm.PackageInfo) = (if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else p.signatures)
            ?.map { it.toCharsString() }?.toSet().orEmpty()
        val a = certs(archive)
        return a.isNotEmpty() && a == certs(mine)
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            if (Build.VERSION.SDK_INT >= 34) setRequestUpdateOwnership(true)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("echopdo.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val status = PendingIntent.getBroadcast(ctx, id, Intent(ctx, UpdateReceiver::class.java).setAction(INSTALLED),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            s.commit(status.intentSender)
        }
    }

    fun notify(ctx: Context, title: String, text: String, tap: PendingIntent?) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "New versions of eChopdo" })
        nm.notify(NID, Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat).setColor(0xFF60A5FA.toInt())
            .setContentTitle(title).setContentText(text).setAutoCancel(true).apply { tap?.let { setContentIntent(it) } }.build())
    }
}

class UpdateWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result = try { Updates.run(applicationContext); Result.success() } catch (e: Exception) { Result.retry() }
}

// PackageInstaller's answer. The first time (or on Android < 12) Android needs one tap to confirm.
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                // Starting it directly only works while eChopdo is on screen; otherwise a notification does it.
                runCatching { ctx.startActivity(confirm) }
                Updates.notify(ctx, "eChopdo ${Store.latestName(ctx)} is ready", "Tap to install the update",
                    PendingIntent.getActivity(ctx, 30_002, confirm, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // MY_PACKAGE_REPLACED handles the restart
            else -> Store.setUpdateError(ctx, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Install failed")
        }
    }
}
