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
    var current: LatLng? = null
        private set
    var onUpdate: (() -> Unit)? = null

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
        // Seed from the last known fix so the puck appears at once.
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            try {
                lm.getLastKnownLocation(provider)?.let { accept(it) }
                lm.requestLocationUpdates(provider, 3000L, 5f, this, Looper.getMainLooper())
            } catch (e: Throwable) {
                Log.w(TAG, "provider $provider unavailable: ${e.message}")
            }
        }
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
        val next = LatLng(location.latitude, location.longitude)
        if (current?.let { it.latitude == next.latitude && it.longitude == next.longitude } == true) return
        current = next
        onUpdate?.invoke()
    }

    private companion object {
        const val TAG = "CarLocation"
    }
}
