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
    private val onOpenList: (() -> Unit)? = null,
) {
    private val ui = CarUi()

    var data: CarMapData = CarMapStore.fallback()
    private var selected: CarMarker? = null
    private var layersOpen = false

    fun reset() {
        selected = null
        layersOpen = false
    }

    /** True when the tap was consumed; the caller should repaint either way. */
    fun tap(x: Float, y: Float): Boolean {
        if (ui.tap(x, y)) return true
        if (layersOpen) return false
        selected = renderer.markerAt(x, y)
        return selected != null
    }

    fun blockingGesture(): Boolean = layersOpen

    fun draw(canvas: Canvas, width: Int, height: Int) {
        ui.begin(width, height)
        val w = width.toFloat()
        val h = height.toFloat()

        val barBottom = ui.appBar(canvas, width, "Mapa", subtitle(), onRefresh)

        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(30f), CarUi.Icon.LAYERS) {
            layersOpen = !layersOpen
            selected = null
        }
        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(82f), CarUi.Icon.LOCATE) {
            renderer.setCamera(data.center, 13.0)
        }
        onOpenList?.let { open ->
            ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(134f), CarUi.Icon.REFRESH) { open() }
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
        return "zajęte rewiry: $taken · $age"
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
        ui.fab(canvas, rect.right - ui.dp(18f), rect.top + ui.dp(16f), CarUi.Icon.CLOSE) {
            selected = null
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
        ui.fab(canvas, rect.right - ui.dp(20f), rect.top + ui.dp(18f), CarUi.Icon.CLOSE) {
            layersOpen = false
        }

        var y = rect.top + ui.dp(34f)
        val rowH = ui.dp(26f)
        for ((label, on) in CarMapStore.layerSummary(data)) {
            if (y > rect.bottom - rowH) break
            ui.checkboxRow(
                canvas,
                RectF(rect.left + ui.dp(4f), y, rect.right - ui.dp(4f), y + rowH),
                label,
                on,
            ) { /* read-only: the phone decides which layers are on */ }
            y += rowH
        }
    }
}
