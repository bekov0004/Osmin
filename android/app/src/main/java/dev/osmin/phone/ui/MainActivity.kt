package dev.osmin.phone.ui

import android.Manifest
import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import dev.osmin.phone.start.AppModel
import dev.osmin.phone.start.ConnectTarget
import dev.osmin.phone.start.PairingNotification

/**
 * The app's one screen: the steps that connect this phone to Osmin on the computer, each with what it needs and a button.
 * Developer options and Wireless debugging are switches of the system; they cannot be turned on from here, only opened.
 */
class MainActivity : Activity() {
    private lateinit var column: LinearLayout
    private val refresh = { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppModel.init(this)
        column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.rgb(0x1C, 0x1C, 0x1E))
            addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        })
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        AppModel.addListener(refresh)
        render()
    }

    override fun onPause() {
        AppModel.removeListener(refresh)
        super.onPause()
    }

    /** The link Osmin on the computer shows, opened from a QR code or pasted. */
    private fun handle(intent: Intent?) {
        val target = intent?.dataString?.let(ConnectTarget::parse) ?: return
        AppModel.target = target
        if (AppModel.paired && wirelessDebuggingOn())
            AppModel.start(target)
        render()
    }

    private fun developerOptionsOn() = Settings.Global.getInt(contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1
    private fun wirelessDebuggingOn() = Settings.Global.getInt(contentResolver, "adb_wifi_enabled", 0) == 1

    private fun render() {
        column.removeAllViews()
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        fun label(text: String, size: Float, color: Int, bold: Boolean = false, top: Int = 0) = TextView(this).apply {
            this.text = text; textSize = size; setTextColor(color); setLineSpacing(0f, 1.15f)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(-1, -2).also { it.topMargin = px(top) }
        }
        fun button(text: String, enabled: Boolean = true, click: () -> Unit) = Button(this).apply {
            this.text = text; isEnabled = enabled; setOnClickListener { click() }
            layoutParams = LinearLayout.LayoutParams(-2, -2).also { it.topMargin = px(8) }
        }
        fun step(done: Boolean, title: String, detail: String) {
            column.addView(label((if (done) "✓  " else "○  ") + title, 17f, if (done) Color.rgb(0x30, 0xD1, 0x58) else Color.WHITE, bold = true, top = 22))
            column.addView(label(detail, 14f, Color.rgb(0xA0, 0xA0, 0xAA), top = 4))
        }
        column.setPadding(px(24), px(56), px(24), px(32))
        column.addView(label("Osmin Phone", 28f, Color.WHITE, bold = true))
        column.addView(label("Connects this phone to Osmin on your computer, so you can see it and use it there.", 15f, Color.rgb(0xE6, 0xE6, 0xEA), top = 12))

        val target = AppModel.target
        step(target != null, "The computer", target?.let { "Connecting to ${it.host}:${it.port}" }
            ?: "Open the link that Osmin shows on the computer (scan its QR code, or copy the link and paste it here).")
        column.addView(button("Paste the link") {
            val text = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.text?.toString().orEmpty()
            val parsed = ConnectTarget.parse(text)
            if (parsed != null) { AppModel.target = parsed; if (AppModel.paired && wirelessDebuggingOn()) AppModel.start(parsed); render() }
            else column.addView(label("There is no Osmin link in the clipboard.", 14f, Color.rgb(0xFF, 0x9F, 0x0A), top = 8))
        })

        step(developerOptionsOn(), "Developer options", "Settings › About phone › tap \"Build number\" seven times.")
        column.addView(button("Open About phone") { startActivity(Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)) })

        step(wirelessDebuggingOn(), "Wireless debugging", "Settings › Developer options › Wireless debugging: turn it on (the phone must be on Wi-Fi).")
        column.addView(button("Open Developer options") { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) })

        step(AppModel.paired, "Pairing (once)", "Tap \"Pair now\", then in Wireless debugging tap \"Pair device with pairing code\" and type the code into the notification that appears.")
        column.addView(button("Pair now") {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            else
                PairingNotification.show(this)
            startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        })

        column.addView(button("Connect to the computer", enabled = AppModel.paired && target != null && !AppModel.busy) { AppModel.target?.let { AppModel.start(it) } })

        if (AppModel.status.isNotEmpty())
            column.addView(label(AppModel.status, 15f, Color.WHITE, top = 22))
        column.addView(label("The picture and the touches go only between this phone and your computer, on your own network.", 13f, Color.rgb(0x70, 0x70, 0x7A), top = 32))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1 && grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED)
            PairingNotification.show(this)
    }
}
