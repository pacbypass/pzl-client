package com.smallgis.pzl.client.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Everything the car map does over time, shared by the car Screen and the dev
 * harness so the harness exercises the real thing:
 *
 *  - reads the phone's hand-over (`car-map.json`) — only again when it changed;
 *  - works out who is hunting ITSELF (see [CarOccupancy]): at start, on
 *    "Odśwież", and every few minutes while the map is on screen;
 *  - re-judges the position's age on a timer, since fixes simply stop coming
 *    when GPS is lost and nothing else would notice.
 *
 * The camera is taken from the phone only the first time. Refreshing used to
 * throw the map back to wherever the phone's map last was, and closed any
 * card that was open.
 */
class CarMapSession(
    private val context: Context,
    private val renderer: CarMapRenderer,
    private val chrome: CarMapChrome,
    private val location: CarLocation,
    /** Data changed in a way the host's template shows (the "Zajęte (n)" count). */
    private val onChanged: () -> Unit = {},
) {
    companion object {
        private const val TAG = "CarMapSession"
        /** Occupancy refresh while the map is visible. */
        private const val OCCUPANCY_EVERY_MS = 150_000L
        /** How often the position's age is re-judged. */
        private const val LOCATION_TICK_MS = 5_000L
    }

    private val main = Handler(Looper.getMainLooper())
    var data: CarMapData = CarMapStore.fallback()
        private set
    /** The phone's data as published, before the car's own occupancy. */
    private var base: CarMapData = CarMapStore.fallback()
    private var fileStamp: Pair<Long, Long>? = null
    private var cameraSet = false
    private var running = false
    /** Bumped when the phone's hand-over changes, so an occupancy answer
     *  computed against the old style is not painted onto the new one. */
    private var baseGeneration = 0
    private var occupancyInFlight = false

    private val occupancyTick = object : Runnable {
        override fun run() {
            refreshOccupancy()
            main.postDelayed(this, OCCUPANCY_EVERY_MS)
        }
    }

    private val locationTick = object : Runnable {
        override fun run() {
            pushLocation()
            main.postDelayed(this, LOCATION_TICK_MS)
        }
    }

    fun pushLocation() {
        chrome.updateLocation(location.current, location.accuracy, location.ageMs())
    }

    /** Map on screen: timers run. */
    fun start() {
        if (running) return
        running = true
        location.onUpdate = { pushLocation() }
        main.removeCallbacks(locationTick)
        main.post(locationTick)
        main.removeCallbacks(occupancyTick)
        main.post(occupancyTick)
    }

    /** Map off screen: no polling. */
    fun stop() {
        running = false
        main.removeCallbacks(locationTick)
        main.removeCallbacks(occupancyTick)
    }

    /**
     * A surface is ready (again): hand everything to the renderer. The phone's
     * file is re-read only when it changed.
     */
    fun load() {
        val f = CarMapStore.file(context)
        val stamp = f.lastModified() to f.length()
        if (stamp != fileStamp || base.updatedAt == 0L) {
            fileStamp = stamp
            val previous = base
            base = CarMapStore.readOrFallback(context)
            baseGeneration++
            Log.i(TAG, "hand-over ${if (base.updatedAt == previous.updatedAt) "unchanged" else "updated"}: " +
                "style=${base.styleJson.length}B markers=${base.markers.size}")
            // The phone's picture first; the car's own last answer replaces it
            // straight away if it is newer, and a fresh fetch follows.
            data = base
            CarOccupancy.fromCache(context, base.styleJson, applyFor(baseGeneration, true))
            if (running) refreshOccupancy()
        }
        show()
        if (!cameraSet) {
            cameraSet = true
            renderer.setCamera(base.center, base.zoom)
        }
    }

    /** "Odśwież" on the map: new hand-over if any, broken layers retried,
     *  occupancy fetched now. */
    fun refresh() {
        renderer.retryDroppedSources()
        load()
        refreshOccupancy()
    }

    private fun refreshOccupancy() {
        // Before the first load there is no style to place anything on; load()
        // asks as soon as there is.
        if (fileStamp == null || occupancyInFlight) return
        occupancyInFlight = true
        CarOccupancy.refresh(context, base.styleJson, applyFor(baseGeneration, false))
    }

    private fun applyFor(generation: Int, fromCacheOnly: Boolean): (CarOccupancy.Applied?) -> Unit = { applied ->
        if (!fromCacheOnly) occupancyInFlight = false
        when {
            generation != baseGeneration -> {
                // The hand-over changed underneath; ask again against the new one.
                if (!fromCacheOnly) refreshOccupancy()
            }
            applied == null -> {
                // Nothing at all to go on: keep what is shown. Never "all free".
                Log.i(TAG, "occupancy unavailable; keeping what is shown")
            }
            // An offline copy only wins over what is shown when it is newer.
            fromCacheOnly && (applied.fetchedAt < base.updatedAt || data.occupancyAt >= applied.fetchedAt) ->
                Unit
            else -> {
                Log.i(TAG, "occupancy: ${applied.markers.size} taken rewir(y)" +
                    if (applied.offline) " (offline copy)" else "")
                data = base.copy(
                    styleJson = applied.styleJson,
                    markers = applied.markers,
                    occupiedShapes = applied.shapes,
                    occupancyAt = applied.fetchedAt,
                    occupancyOffline = applied.offline,
                )
                show()
                onChanged()
            }
        }
    }

    private fun show() {
        chrome.data = data
        renderer.setStyle(data.styleJson)
        renderer.setMarkers(data.markers)
        renderer.setDevices(data.devices)
        renderer.setShapes(data.occupiedShapes)
        pushLocation()
    }
}
