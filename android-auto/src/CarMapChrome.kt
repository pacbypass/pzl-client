package com.smallgis.pzl.client.car

import android.graphics.Canvas
import android.graphics.RectF

/**
 * The app's UI, painted over the map.
 *
 * It lives apart from the car Screen on purpose: the Screen only exists when a
 * head unit is attached, so keeping the chrome here lets the dev harness
 * (`CarMapPreviewActivity`) draw exactly what the car draws, and the layout can
 * be checked at 800x400 without a car.
 */
class CarMapChrome(
    private val renderer: CarMapRenderer,
    private val onRefresh: () -> Unit,
    private val onLocate: (() -> Unit)? = null,
    /** The car hides it (the host strip owns that corner); the harness shows it. */
    private val showRefresh: Boolean = false,
) {
    private val ui = CarUi()

    var data: CarMapData = CarMapStore.fallback()
    private var selected: CarMarker? = null
    private var selectedDevice: CarDevice? = null
    private var layersOpen = false

    fun reset() {
        selected = null
        selectedDevice = null
        layersOpen = false
    }

    /** True when the tap was consumed; the caller should repaint either way. */
    fun tap(x: Float, y: Float): Boolean {
        if (ui.tap(x, y)) return true
        if (layersOpen) {
            layersOpen = false
            return true
        }
        // Same rule as the phone: whichever is nearer, a rewir pin or a device.
        // Falling back to the rewir's polygon means tapping the red area works
        // too, which matters far more with a finger in a moving car.
        val pin = renderer.markerAt(x, y)
        val device = renderer.deviceAt(x, y)
        val pinDist = pin?.let { renderer.markerDistance(x, y, it) } ?: Float.MAX_VALUE
        val deviceDist = device?.let { d ->
            renderer.deviceAt(x, y)?.let { renderer.markerDistanceTo(x, y, d.position) }
        } ?: Float.MAX_VALUE

        selected = null
        selectedDevice = null
        when {
            pin != null && pinDist <= deviceDist -> selected = pin
            device != null -> selectedDevice = device
            else -> selected = renderer.shapeAt(x, y)
        }
        renderer.setHighlight(selectedDevice?.position ?: selected?.position)
        return selected != null || selectedDevice != null
    }

    fun blockingGesture(): Boolean = layersOpen

    fun draw(canvas: Canvas, width: Int, height: Int) {
        ui.begin(width, height)
        val w = width.toFloat()
        val h = height.toFloat()

        // In the car the app bar carries no buttons: the host paints its own
        // action strip over the top-right of this surface and anything drawn
        // there would sit underneath it. The dev harness has no such strip, so
        // it keeps the refresh button.
        val barBottom = ui.appBar(
            canvas,
            width,
            "Mapa",
            subtitle(),
            if (showRefresh) onRefresh else null,
        )

        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(46f), CarUi.Icon.LAYERS) {
            layersOpen = !layersOpen
            selected = null
            selectedDevice = null
            renderer.setHighlight(null)
        }
        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(98f), CarUi.Icon.LOCATE) {
            onLocate?.invoke()
        }

        if (!layersOpen) drawLegend(canvas, h)
        selected?.let { drawHunterCard(canvas, w, h, it) }
        selectedDevice?.let { drawDeviceCard(canvas, w, h, it) }
        if (layersOpen) drawLayersPanel(canvas, w, h, barBottom)
    }

    /** Koło name plus how old the phone's data is — the phone shows the unit
     *  name and a DataAge chip in the same place. */
    private fun subtitle(): String {
        val unit = data.unit?.let { "$it · " } ?: ""
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
        return "$unit$age · zajęte rewiry: ${data.markers.size}"
    }

    /** Device-type legend, bottom-left, exactly as on the phone. */
    private fun drawLegend(canvas: Canvas, h: Float) {
        val types = data.devices
            .filter { it.type.isNotBlank() }
            .groupBy { it.type to it.color }
            .keys
            .take(7)
        if (types.isEmpty()) return
        val rowH = ui.dp(15f)
        val rect = RectF(
            ui.dp(10f),
            h - ui.dp(14f) - types.size * rowH,
            ui.dp(132f),
            h - ui.dp(8f),
        )
        ui.card(canvas, rect, CarTheme.surface, ui.dp(10f))
        var y = rect.top + ui.dp(13f)
        for ((label, color) in types) {
            ui.legendRow(canvas, rect.left + ui.dp(10f), y, label, color)
            y += rowH
        }
    }

    /** The phone's device card: name, then "type · nr N". */
    private fun drawDeviceCard(canvas: Canvas, w: Float, h: Float, device: CarDevice) {
        val rect = RectF(w * 0.30f, h - ui.dp(58f), w - ui.dp(12f), h - ui.dp(12f))
        ui.card(canvas, rect)
        ui.row(
            canvas,
            RectF(rect.left, rect.top, rect.right - ui.dp(30f), rect.bottom),
            device.name,
            listOfNotNull(
                device.type.takeIf { it.isNotBlank() },
                device.number?.let { "nr $it" },
            ).joinToString(" · "),
            device.color,
        )
        ui.iconButton(canvas, rect.right - ui.dp(16f), rect.top + ui.dp(15f), CarUi.Icon.CLOSE) {
            selectedDevice = null
            renderer.setHighlight(null)
        }
    }

    /** The phone's bottom card: rewir, obwód, and who is signed up there. */
    private fun drawHunterCard(canvas: Canvas, w: Float, h: Float, marker: CarMarker) {
        val lines = marker.subtitle.split("\n").filter { it.isNotBlank() }
        val cardH = ui.dp(30f) + lines.size * ui.dp(16f)
        val rect = RectF(ui.dp(12f), h - cardH - ui.dp(12f), w * 0.58f, h - ui.dp(12f))
        ui.card(canvas, rect)

        ui.row(
            canvas,
            RectF(rect.left, rect.top, rect.right - ui.dp(32f), rect.top + ui.dp(26f)),
            marker.title,
            null,
            CarTheme.occupied,
        )
        var y = rect.top + ui.dp(40f)
        for (line in lines) {
            ui.label(
                canvas,
                ui.clip(line, ui.dp(12f), rect.width() - ui.dp(26f)),
                rect.left + ui.dp(13f),
                y,
                ui.dp(12f),
                if (line.contains("po czasie")) CarTheme.occupied else CarTheme.onSurface,
            )
            y += ui.dp(16f)
        }
        ui.iconButton(canvas, rect.right - ui.dp(16f), rect.top + ui.dp(15f), CarUi.Icon.CLOSE) {
            selected = null
            renderer.setHighlight(null)
        }
    }

    /** Mirrors the phone's layers panel; the phone owns the settings. */
    private fun drawLayersPanel(canvas: Canvas, w: Float, h: Float, top: Float) {
        ui.scrim(canvas, w.toInt(), h.toInt()) { layersOpen = false }
        val rect = RectF(w * 0.40f, top + ui.dp(8f), w - ui.dp(10f), h - ui.dp(10f))
        ui.card(canvas, rect, CarTheme.background)

        ui.label(
            canvas, "Warstwy", rect.left + ui.dp(13f), rect.top + ui.dp(22f),
            ui.dp(15f), CarTheme.onSurface, bold = true,
        )
        ui.iconButton(canvas, rect.right - ui.dp(18f), rect.top + ui.dp(17f), CarUi.Icon.CLOSE) {
            layersOpen = false
        }

        var y = rect.top + ui.dp(34f)
        val rowH = ui.dp(26f)
        for ((label, on, unavailable) in CarMapStore.layerSummary(data, renderer.droppedSources())) {
            if (y > rect.bottom - rowH) break
            ui.checkboxRow(
                canvas,
                RectF(rect.left + ui.dp(4f), y, rect.right - ui.dp(4f), y + rowH),
                if (unavailable) "$label — niedostępna" else label,
                on,
            ) { /* read-only: the phone decides which layers are on */ }
            y += rowH
        }
    }
}
