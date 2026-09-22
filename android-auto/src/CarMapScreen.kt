package com.smallgis.pzl.client.car

import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * The map on the car screen. The template only supplies the chrome (action
 * strips); everything inside is drawn by [CarMapRenderer] onto the surface the
 * host hands us, which is what allows the real obwód/rewir polygons and our own
 * base layers rather than host-rendered pins.
 */
class CarMapScreen(carContext: CarContext) : Screen(carContext), SurfaceCallback, DefaultLifecycleObserver {

    private val renderer = CarMapRenderer(carContext)
    private var data: CarMapData = CarMapStore.fallback()

    init {
        lifecycle.addObserver(this)
    }

    override fun onCreate(owner: LifecycleOwner) {
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
    }

    override fun onDestroy(owner: LifecycleOwner) {
        renderer.detach()
    }

    // ---- surface ---------------------------------------------------------

    override fun onSurfaceAvailable(container: SurfaceContainer) {
        val surface = container.surface ?: return
        renderer.attach(surface, container.width, container.height, container.dpi)
        load()
    }

    override fun onSurfaceDestroyed(container: SurfaceContainer) {
        renderer.detach()
    }

    private fun load() {
        data = CarMapStore.readOrFallback(carContext)
        renderer.setStyle(data.styleJson)
        renderer.setMarkers(data.markers)
        renderer.setCamera(data.center, data.zoom)
        invalidate()
    }

    // ---- gestures --------------------------------------------------------

    override fun onScroll(distanceX: Float, distanceY: Float) {
        // The host reports how far the content should move away from the finger.
        renderer.onDrag(-distanceX, -distanceY)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        renderer.onZoom(scaleFactor)
    }

    override fun onClick(x: Float, y: Float) {
        val marker = renderer.markerAt(x, y) ?: return
        screenManager.push(HuntersScreen(carContext, marker))
    }

    // ---- template --------------------------------------------------------

    override fun onGetTemplate(): Template {
        val taken = data.markers.size
        val actions = ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle(if (taken > 0) "Zajęte ($taken)" else "Zajęte")
                    .setOnClickListener { screenManager.push(OccupiedListScreen(carContext, data.markers)) }
                    .build(),
            )
            .addAction(
                Action.Builder()
                    .setTitle("Odśwież")
                    .setOnClickListener { load() }
                    .build(),
            )
            .build()

        // Pan/zoom buttons, so cars without a touchscreen can still move the map.
        val mapActions = ActionStrip.Builder()
            .addAction(Action.Builder(Action.PAN).build())
            .build()

        return NavigationTemplate.Builder()
            .setActionStrip(actions)
            .setMapActionStrip(mapActions)
            .setBackgroundColor(CarColor.PRIMARY)
            .build()
    }
}
