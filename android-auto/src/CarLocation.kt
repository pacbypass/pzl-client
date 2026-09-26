package com.smallgis.pzl.client.car

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import android.util.Log
import org.maplibre.android.geometry.LatLng

/**
 * The driver's position for the car map — the same blue dot the phone shows.
 *
 * Uses the platform LocationManager directly: the car app runs inside the phone
 * app's process and inherits its location grant, and pulling in Play Services
 * for a puck would be a heavy dependency for one coordinate.
 */
class CarLocation(private val context: Context) : LocationListener {

    private var manager: LocationManager? = null
    private var lastFix: Location? = null
    var current: LatLng? = null
        private set
    /** Metres of uncertainty on the current fix, for the accuracy ring. */
    var accuracy: Float = 0f
        private set
    var onUpdate: (() -> Unit)? = null

    /**
     * How old the current fix is, in ms, measured from when the fix was TAKEN
     * (its elapsed-realtime stamp), not when it reached us: the last-known fix
     * a provider hands over at start can be hours old, and stamping it "now"
     * showed it as live. Long.MAX_VALUE when there is no fix.
     */
    fun ageMs(): Long {
        val fix = lastFix ?: return Long.MAX_VALUE
        return ((android.os.SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000)
            .coerceAtLeast(0L)
    }

    private fun allowed(): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun start() {
        if (!allowed()) {
            Log.i(TAG, "no location permission; the car map will not show a puck")
            return
        }
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        manager = lm
        for (provider in providers(lm)) {
            try {
                // Seed from the last known fix so the puck appears at once,
                // then follow.
                lm.getLastKnownLocation(provider)?.let { accept(it) }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                    // Ask for the best the device can do. The legacy call takes
                    // whatever a provider felt like producing, which is why a
                    // deliberate "locate" felt accurate and the puck did not.
                    lm.requestLocationUpdates(
                        provider,
                        android.location.LocationRequest.Builder(1000L)
                            .setQuality(android.location.LocationRequest.QUALITY_HIGH_ACCURACY)
                            .setMinUpdateDistanceMeters(0f)
                            .build(),
                        context.mainExecutor,
                        this,
                    )
                } else {
                    lm.requestLocationUpdates(provider, 1000L, 0f, this, Looper.getMainLooper())
                }
                Log.i(TAG, "following '$provider'")
            } catch (e: Throwable) {
                Log.w(TAG, "provider $provider unavailable: ${e.message}")
            }
        }
    }

    /**
     * FUSED first, and it matters: the phone app gets its position through
     * expo-location, which uses the fused provider, so that is where a fix
     * actually exists. Listening only to GPS/NETWORK left the car with no puck
     * at all until a cold satellite lock — on a test device the platform held a
     * fused fix while GPS's last location was still null.
     */
    private fun providers(lm: LocationManager): List<String> {
        val out = mutableListOf<String>()
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            out.add(LocationManager.FUSED_PROVIDER)
        }
        out.add(LocationManager.GPS_PROVIDER)
        out.add(LocationManager.NETWORK_PROVIDER)
        return out.filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
            .ifEmpty { listOf(LocationManager.GPS_PROVIDER) }
    }

    fun stop() {
        try {
            manager?.removeUpdates(this)
        } catch (e: Throwable) {
            Log.w(TAG, "removeUpdates failed", e)
        }
        manager = null
    }

    override fun onLocationChanged(location: Location) = accept(location)

    private fun accept(location: Location) {
        // Several providers report; keep the freshest rather than the last to
        // arrive, so a stale NETWORK fix cannot overwrite a live GPS one.
        val previous = lastFix
        if (previous != null && location.elapsedRealtimeNanos < previous.elapsedRealtimeNanos) return
        val wasStale = ageMs() > STALE_FIX_MS
        lastFix = location
        accuracy = location.accuracy
        val next = LatLng(location.latitude, location.longitude)
        // Same spot, but a stale fix just became fresh again: that is news.
        if (current?.let { it.latitude == next.latitude && it.longitude == next.longitude } == true &&
            !wasStale
        ) {
            return
        }
        current = next
        Log.i(
            TAG,
            "fix from ${location.provider} ±${location.accuracy.toInt()}m " +
                "(${"%.4f".format(location.latitude)}, ${"%.4f".format(location.longitude)})",
        )
        onUpdate?.invoke()
    }

    companion object {
        private const val TAG = "CarLocation"
        /** Past this a fix is shown as stale rather than trusted. */
        const val STALE_FIX_MS = 30_000L
    }
}
