package dev.osmin.phone.ui

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Osmin Phone"; textSize = 20f; setPadding(48, 96, 48, 48) })
    }
}
