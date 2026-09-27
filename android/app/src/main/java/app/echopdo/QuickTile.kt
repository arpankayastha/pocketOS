package app.echopdo

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

// Quick-settings tile "eChopdo +": opens the quick-add sheet from the notification shade.
class QuickTile : TileService() {
    override fun onStartListening() {
        qsTile?.apply { state = Tile.STATE_INACTIVE; updateTile() }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        val intent = QuickWidget.quickIntent(this, "out")
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 5, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION") startActivityAndCollapse(intent)
        }
    }
}
