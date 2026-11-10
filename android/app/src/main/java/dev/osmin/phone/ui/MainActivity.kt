package dev.osmin.phone.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import dev.osmin.phone.R

/**
 * What the app shows when it is opened: what it is for. The work is done by its server (dev.osmin.phone.server),
 * which the computer starts on the phone; there is nothing to press here.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        fun px(value: Int) = (value * dp).toInt()

        fun text(resource: Int, size: Float, color: Int, bold: Boolean = false, top: Int = 0, vararg args: Any) =
            TextView(this).apply {
                text = getString(resource, *args)
                textSize = size
                setTextColor(color)
                if (bold) setTypeface(typeface, Typeface.BOLD)
                setLineSpacing(0f, 1.15f)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    .also { it.topMargin = px(top) }
            }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            setPadding(px(28), px(64), px(28), px(32))
            addView(text(R.string.about_title, 28f, Color.WHITE, bold = true))
            addView(text(R.string.about_what, 16f, Color.rgb(0xE6, 0xE6, 0xEA), top = 20))
            addView(text(R.string.about_how, 16f, Color.rgb(0xE6, 0xE6, 0xEA), top = 16))
            addView(text(R.string.about_needs, 14f, Color.rgb(0xA0, 0xA0, 0xAA), top = 24))
            addView(text(R.string.about_privacy, 14f, Color.rgb(0xA0, 0xA0, 0xAA), top = 16))
            addView(text(R.string.about_version, 13f, Color.rgb(0x70, 0x70, 0x7A), top = 32, args = arrayOf(versionName())))
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.rgb(0x1C, 0x1C, 0x1E))
            addView(column)
        })
    }

    private fun versionName(): String =
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
}
