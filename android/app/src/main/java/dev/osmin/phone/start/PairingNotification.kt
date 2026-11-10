package dev.osmin.phone.start

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The pairing code is shown by the phone in a window of the settings, and that window closes when another app comes
 * to the front. So the code is typed into a notification (it stays over the settings): "Enter the pairing code".
 */
object PairingNotification {
    private const val CHANNEL = "pairing"
    private const val ID = 7
    const val KEY_CODE = "code"

    fun show(context: Context, text: String = "Type the pairing code of the pairing window here") {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Pairing", NotificationManager.IMPORTANCE_HIGH))
        val intent = Intent(context, PairingReceiver::class.java)
        val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val input = RemoteInput.Builder(KEY_CODE).setLabel("Pairing code").build()
        val action = Notification.Action.Builder(null, "Enter code", pending).addRemoteInput(input).build()
        manager.notify(ID, Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("Osmin Phone")
            .setContentText(text)
            .setOngoing(true)
            .addAction(action)
            .build())
    }

    fun update(context: Context, text: String, done: Boolean) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (done) {
            manager.cancel(ID)
            return
        }
        show(context, text)
    }

    fun cancel(context: Context) = context.getSystemService(NotificationManager::class.java).cancel(ID)
}

class PairingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val code = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(PairingNotification.KEY_CODE)?.toString()?.trim().orEmpty()
        AppModel.init(context)
        val pending = goAsync()
        // Ends the broadcast when the work is done, or in any case before the system's limit.
        val watchdog = android.os.Handler(android.os.Looper.getMainLooper())
        val finish = Runnable { try { pending.finish() } catch (ignored: IllegalStateException) {} }
        watchdog.postDelayed(finish, 9000)
        val app = context.applicationContext
        PairingNotification.update(app, "Pairing…", done = false)
        AppModel.pair(code) { PairingNotification.cancel(app) }
        AppModel.runLater {
            // The work above is queued first; this runs after it.
            PairingNotification.update(app, AppModel.status, done = AppModel.paired)
            watchdog.post(finish)
        }
    }
}
