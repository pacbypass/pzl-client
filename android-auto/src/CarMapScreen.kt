package com.smallgis.pzl.client.car

import android.graphics.Canvas
import android.graphics.RectF
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * The map, as the phone shows it.
 *
 * The host template supplies nothing but a surface and a thin action strip;
 * everything the user sees — app bar, buttons, the layers panel, the "kto tu
 * poluje" card — is drawn by [CarUi] over the map [CarMapRenderer] renders.
 * That is what makes the car screen resemble the phone, and it also sidesteps
 * the template row limits, since none of this is a host template.
 */
class CarMapScreen(carContext: CarContext) : Screen(carContext), SurfaceCallback, DefaultLifecycleObserver {

    private val renderer = CarMapRenderer(carContext)
    private val location = CarLocation(carContext)
    private val chrome = CarMapChrome(
        carContext,
        renderer,
        onRefresh = { refresh() },
        onLocate = { centreOnMe() },
    )
    private var data: CarMapData = CarMapStore.fallback()

    init {
        lifecycle.addObserver(this)
        renderer.overlay = { canvas, w, h -> chrome.draw(canvas, w, h) }
        // The strip's actions depend on the tab, so rebuild the template when
        // it changes: "Zajęte" belongs to the map, not to the book.
        chrome.onTabChanged = { invalidate() }
    }

    override fun onCreate(owner: LifecycleOwner) {
        android.util.Log.i(TAG, "registering surface callback")
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        location.onUpdate = {
            renderer.setUserLocation(location.current)
        }
        location.start()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        location.stop()
        renderer.detach()
    }

    /** The crosshair button: go to the driver, like the phone's locate FAB. */
    private fun centreOnMe() {
        val at = location.current
        if (at == null) {
            android.util.Log.i(TAG, "locate: no fix yet")
            return
        }
        renderer.setCamera(at, 14.0)
    }

    // ---- surface ---------------------------------------------------------

    override fun onSurfaceAvailable(container: SurfaceContainer) {
        val surface = container.surface
        android.util.Log.i(
            TAG,
            "onSurfaceAvailable surface=$surface ${container.width}x${container.height}",
        )
        if (surface == null) return
        renderer.attach(surface, container.width, container.height, container.dpi)
        load()
    }

    override fun onSurfaceDestroyed(container: SurfaceContainer) {
        renderer.detach()
    }

    private fun load() {
        val previous = data.updatedAt
        data = CarMapStore.readOrFallback(carContext)
        android.util.Log.i(
            TAG,
            "refresh: file ${if (data.updatedAt == previous) "unchanged" else "updated"}",
        )
        android.util.Log.i(
            TAG,
            "load style=${data.styleJson.length}B markers=${data.markers.size} updated=${data.updatedAt}",
        )
        chrome.data = data
        chrome.reset()
        renderer.setStyle(data.styleJson)
        renderer.setMarkers(data.markers)
        renderer.setDevices(data.devices)
        renderer.setShapes(data.occupiedShapes)
        renderer.setUserLocation(location.current)
        renderer.setCamera(data.center, data.zoom)
        invalidate()
    }

    // ---- gestures --------------------------------------------------------

    override fun onScroll(distanceX: Float, distanceY: Float) {
        // On the book tab the same gesture scrolls the list.
        if (chrome.onScroll(distanceY)) return
        if (chrome.blockingGesture()) return
        renderer.onDrag(-distanceX, -distanceY)
    }

    /** Refresh reloads whichever tab is in front. */
    private fun refresh() {
        if (chrome.tab() == CarTab.BOOK) {
            chrome.reloadBook()
        } else {
            renderer.retryDroppedSources()
            load()
        }
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        if (!chrome.blockingGesture()) renderer.onZoomAt(focusX, focusY, scaleFactor)
    }

    override fun onClick(x: Float, y: Float) {
        // Chrome first: a tap on a control never reaches the map.
        chrome.tap(x, y)
        renderer.redraw()
    }

    // ---- template --------------------------------------------------------

    override fun onGetTemplate(): Template {
        // The host paints this strip over the top-right of our surface, so it
        // holds the actions rather than duplicating them on the map itself.
        val actions = ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle("Odśwież")
                    .setOnClickListener { refresh() }
                    .build(),
            )
            .apply {
                if (chrome.tab() == CarTab.MAP) {
                    addAction(
                        Action.Builder()
                            .setTitle("Zajęte (${data.markers.size})")
                            .setOnClickListener {
                                screenManager.push(OccupiedListScreen(carContext, data.markers))
                            }
                            .build(),
                    )
                }
            }
            .build()

        val mapActions = ActionStrip.Builder()
            .addAction(Action.Builder(Action.PAN).build())
            .build()

        return NavigationTemplate.Builder()
            .setActionStrip(actions)
            .setMapActionStrip(mapActions)
            .build()
    }

    private companion object {
        const val TAG = "CarMapScreen"
    }
}
