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
    private val chrome = CarMapChrome(
        renderer,
        onRefresh = { load() },
        onOpenList = { screenManager.push(OccupiedListScreen(carContext, data.markers)) },
    )
    private var data: CarMapData = CarMapStore.fallback()

    init {
        lifecycle.addObserver(this)
        renderer.overlay = { canvas, w, h -> chrome.draw(canvas, w, h) }
    }

    override fun onCreate(owner: LifecycleOwner) {
        android.util.Log.i(TAG, "registering surface callback")
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
    }

    override fun onDestroy(owner: LifecycleOwner) {
        renderer.detach()
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
        data = CarMapStore.readOrFallback(carContext)
        android.util.Log.i(
            TAG,
            "load style=${data.styleJson.length}B markers=${data.markers.size} updated=${data.updatedAt}",
        )
        chrome.data = data
        chrome.reset()
        renderer.setStyle(data.styleJson)
        renderer.setMarkers(data.markers)
        renderer.setCamera(data.center, data.zoom)
        invalidate()
    }

    // ---- gestures --------------------------------------------------------

    override fun onScroll(distanceX: Float, distanceY: Float) {
        if (chrome.blockingGesture()) return
        renderer.onDrag(-distanceX, -distanceY)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        if (!chrome.blockingGesture()) renderer.onZoom(scaleFactor)
    }

    override fun onClick(x: Float, y: Float) {
        // Chrome first: a tap on a control never reaches the map.
        chrome.tap(x, y)
        renderer.redraw()
    }

    // ---- template --------------------------------------------------------

    override fun onGetTemplate(): Template {
        val actions = ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle("Zajęte (${data.markers.size})")
                    .setOnClickListener { screenManager.push(OccupiedListScreen(carContext, data.markers)) }
                    .build(),
            )
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
