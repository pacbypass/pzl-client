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
    private val ui = CarUi()
    private var data: CarMapData = CarMapStore.fallback()

    /** Which taken rewir's card is open, if any. */
    private var selected: CarMarker? = null
    private var layersOpen = false

    init {
        lifecycle.addObserver(this)
        renderer.overlay = { canvas, w, h -> drawChrome(canvas, w, h) }
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
        selected = null
        renderer.setStyle(data.styleJson)
        renderer.setMarkers(data.markers)
        renderer.setCamera(data.center, data.zoom)
        invalidate()
    }

    // ---- gestures --------------------------------------------------------

    override fun onScroll(distanceX: Float, distanceY: Float) {
        if (layersOpen) return
        renderer.onDrag(-distanceX, -distanceY)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        if (!layersOpen) renderer.onZoom(scaleFactor)
    }

    override fun onClick(x: Float, y: Float) {
        // Chrome first: a tap that lands on a control never reaches the map.
        if (ui.tap(x, y)) {
            renderer.redraw()
            return
        }
        if (layersOpen) return
        selected = renderer.markerAt(x, y)
        renderer.redraw()
    }

    // ---- chrome ----------------------------------------------------------

    private fun drawChrome(canvas: Canvas, width: Int, height: Int) {
        ui.begin(width, height)
        val w = width.toFloat()
        val h = height.toFloat()

        val barBottom = ui.appBar(
            canvas,
            width,
            title = "Mapa",
            subtitle = subtitle(),
            onRefresh = { load() },
        )

        // Right-hand buttons, as on the phone: layers, then locate.
        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(30f), CarUi.Icon.LAYERS) {
            layersOpen = !layersOpen
            selected = null
        }
        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(82f), CarUi.Icon.LOCATE) {
            data.center.let { renderer.setCamera(it, 13.0) }
        }

        selected?.let { drawHunterCard(canvas, w, h, it) }
        if (layersOpen) drawLayersPanel(canvas, w, h, barBottom)
    }

    private fun subtitle(): String {
        val taken = data.markers.size
        val age = if (data.updatedAt > 0) {
            val mins = (System.currentTimeMillis() - data.updatedAt) / 60000
            when {
                mins < 1 -> "dane: przed chwilą"
                mins < 60 -> "dane: $mins min temu"
                mins < 60 * 24 -> "dane: ${mins / 60} godz. temu"
                else -> "dane: ${mins / (60 * 24)} dni temu"
            }
        } else {
            "brak danych z telefonu"
        }
        return "$taken zajętych rewirów · $age"
    }

    /** The phone's bottom card: which rewir, which obwód, who is signed up. */
    private fun drawHunterCard(canvas: Canvas, w: Float, h: Float, marker: CarMarker) {
        val lines = marker.subtitle.split("\n").filter { it.isNotBlank() }
        val cardH = ui.dp(34f) + lines.size * ui.dp(17f)
        val rect = RectF(ui.dp(12f), h - cardH - ui.dp(12f), w * 0.62f, h - ui.dp(12f))
        ui.card(canvas, rect)

        ui.row(
            canvas,
            RectF(rect.left, rect.top, rect.right - ui.dp(34f), rect.top + ui.dp(30f)),
            title = marker.title,
            subtitle = null,
            dotColor = CarTheme.occupied,
        )
        var y = rect.top + ui.dp(44f)
        for (line in lines) {
            ui.label(
                canvas,
                ui.clip(line, ui.dp(12f), rect.width() - ui.dp(28f)),
                rect.left + ui.dp(14f),
                y,
                ui.dp(12f),
                if (line.contains("po czasie")) CarTheme.occupied else CarTheme.onSurface,
            )
            y += ui.dp(17f)
        }
        ui.fab(canvas, rect.right - ui.dp(20f), rect.top + ui.dp(18f), CarUi.Icon.CLOSE) {
            selected = null
        }
    }

    /** The layers panel — the same list as the phone, minus what the car cannot
     *  act on. Read-only for now: the phone owns the settings. */
    private fun drawLayersPanel(canvas: Canvas, w: Float, h: Float, top: Float) {
        ui.scrim(canvas, w.toInt(), h.toInt()) { layersOpen = false }
        val rect = RectF(w * 0.42f, top + ui.dp(8f), w - ui.dp(12f), h - ui.dp(12f))
        ui.card(canvas, rect, CarTheme.background)

        ui.label(
            canvas, "Warstwy", rect.left + ui.dp(14f), rect.top + ui.dp(24f),
            ui.dp(16f), CarTheme.onSurface, bold = true,
        )
        ui.fab(canvas, rect.right - ui.dp(22f), rect.top + ui.dp(20f), CarUi.Icon.CLOSE) {
            layersOpen = false
        }

        var y = rect.top + ui.dp(38f)
        val rowH = ui.dp(30f)
        for (layer in CarMapStore.layerSummary(data)) {
            ui.checkboxRow(
                canvas,
                RectF(rect.left + ui.dp(6f), y, rect.right - ui.dp(6f), y + rowH),
                layer.first,
                layer.second,
            ) { /* the phone owns which layers are on */ }
            y += rowH
            if (y > rect.bottom - rowH) break
        }
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
