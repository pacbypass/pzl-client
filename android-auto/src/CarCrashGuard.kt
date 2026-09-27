package com.smallgis.pzl.client.car

import android.content.Context
import android.util.Log
import android.view.Surface
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Two things for when the app dies with the car screen up.
 *
 * 1. It lets go of the car's drawing surface first. The Android Auto host does
 *    not notice a producer that dies without disconnecting: it keeps counting
 *    the dead process as connected, every later attempt to draw fails
 *    ("already connected"), and the car stays frozen on whatever was drawn
 *    before the crash — for the rest of the drive. Seen on the real host.
 * 2. It writes the crash to `car-crash.txt`, which the phone app's Debug tab
 *    shows, so a crash in the car is never invisible again.
 */
object CarCrashGuard {
    private const val TAG = "CarCrashGuard"
    const val FILE = "car-crash.txt"
    private const val MAX_BYTES = 32 * 1024

    /** The surface the car map currently draws on, if any. */
    @Volatile
    var surface: Surface? = null

    @Volatile
    private var installed = false

    fun install(context: Context) {
        if (installed) return
        installed = true
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                surface?.release()
            } catch (_: Throwable) {
            }
            try {
                record(app, thread, error)
            } catch (_: Throwable) {
            }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun record(context: Context, thread: Thread, error: Throwable) {
        val file = File(context.filesDir, FILE)
        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val entry = "=== $stamp · wątek ${thread.name} ===\n${Log.getStackTraceString(error)}\n"
        val old = if (file.exists()) file.readText() else ""
        // Newest first, and bounded.
        file.writeText((entry + old).take(MAX_BYTES))
    }

    /** Let go of a surface we are done with, so the host can hand it on. */
    fun release(surface: Surface?) {
        if (surface == null) return
        try {
            surface.release()
        } catch (e: Throwable) {
            Log.w(TAG, "release failed", e)
        }
        if (this.surface === surface) this.surface = null
    }
}
