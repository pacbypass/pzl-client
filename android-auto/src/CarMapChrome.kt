package com.smallgis.pzl.client.car

import android.graphics.Canvas
import android.graphics.RectF
import org.maplibre.android.geometry.LatLng

/**
 * The app's UI, painted over the map.
 *
 * It lives apart from the car Screen on purpose: the Screen only exists when a
 * head unit is attached, so keeping the chrome here lets the dev harness
 * (`CarMapPreviewActivity`) draw exactly what the car draws, and the layout can
 * be checked at 800x400 without a car.
 */
/** Which of the app's tabs the car screen is showing. */
enum class CarTab { MAP, BOOK }

/** Where the driver is, in the koło's own terms. */
data class CarWhereAmI(val text: String, val warn: Boolean)

class CarMapChrome(
    private val context: android.content.Context,
    private val renderer: CarMapRenderer,
    private val onRefresh: () -> Unit,
    private val onLocate: (() -> Unit)? = null,
    /** The car hides it (the host strip owns that corner); the harness shows it. */
    private val showRefresh: Boolean = false,
) {
    private val ui = CarUi()
    private val book = CarBookView(context, ui) { renderer.redraw() }
    private var tab = CarTab.MAP

    /** Called when the tab changes, so the host's action strip can be rebuilt
     *  — its actions differ per tab. */
    var onTabChanged: (() -> Unit)? = null

    /**
     * Which rewir the driver is standing in, recomputed as fixes arrive. The
     * point of the car screen is knowing you are where you are allowed to be,
     * so this is stated outright instead of left to be read off the map.
     */
    var whereAmI: CarWhereAmI? = null
        private set

    /**
     * One entry point for a new fix, shared by the car Screen and the dev
     * harness — position, its uncertainty, and which rewir it falls in. Keeping
     * this in the Screen meant the harness could not exercise it.
     */
    fun updateLocation(position: LatLng?, accuracy: Float, ageMs: Long) {
        renderer.setUserLocation(position)
        // Also called on a timer, not only when a fix arrives: fixes simply
        // stop coming in a tunnel or a forest, and the readout has to notice.
        val stale = ageMs > CarLocation.STALE_FIX_MS
        renderer.setUserAccuracy(accuracy, stale)
        whereAmI = when {
            position == null -> null
            stale -> CarWhereAmI("Lokalizacja nieaktualna", true)
            else -> {
                val rewir = CarMapStore.rewirAt(data, position.longitude, position.latitude)
                val metres = "±${accuracy.toInt()}m"
                if (rewir == null) {
                    CarWhereAmI("Poza rewirami koła · $metres", true)
                } else {
                    val district = CarApi.access(context)?.districts
                        ?.firstOrNull { it.first == rewir.districtId }?.second
                    CarWhereAmI(
                        listOfNotNull("Rewir ${rewir.name}", district?.let { "Obwód $it" }, metres)
                            .joinToString(" · "),
                        false,
                    )
                }
            }
        }
        renderer.redraw()
    }

    /**
     * New data keeps what the driver had open. A refresh used to close every
     * card and panel; now a selected rewir stays selected — with its fresh
     * hunter list — and only closes once nobody is hunting there any more.
     */
    var data: CarMapData = CarMapStore.fallback()
        set(value) {
            field = value
            selected = selected?.let { old -> value.markers.firstOrNull { it.id == old.id } }
            if (selected == null && selectedDevice == null) renderer.setHighlight(null)
        }
    private var selected: CarMarker? = null
    private var selectedDevice: CarDevice? = null
    private var layersOpen = false

    fun reset() {
        selected = null
        selectedDevice = null
        layersOpen = false
    }

    fun tab(): CarTab = tab

    fun reloadBook() = book.reload()

    /** Drag on the book tab scrolls the list instead of panning the map. */
    fun onScroll(dy: Float): Boolean {
        if (tab != CarTab.BOOK) return false
        book.onScroll(dy)
        return true
    }

    /** True when the tap was consumed; the caller should repaint either way. */
    fun tap(x: Float, y: Float): Boolean {
        if (ui.tap(x, y)) return true
        if (tab == CarTab.BOOK) return book.blocking()
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

    fun blockingGesture(): Boolean =
        layersOpen || tab == CarTab.BOOK || book.blocking()

    fun draw(canvas: Canvas, width: Int, height: Int) {
        ui.begin(width, height)
        val w = width.toFloat()
        // Everything sits above the tab bar, which is drawn last so its taps win.
        val h = height - ui.dp(42f)

        if (tab == CarTab.BOOK) {
            book.draw(canvas, width, height, h)
            drawTabs(canvas, width, height)
            return
        }

        // No app bar on the map either: the whole point of this screen is the
        // map, and the host already paints its own strip over the top. The
        // status line is drawn small, bottom-left, above the legend.
        val barBottom = 0f
        if (showRefresh) {
            // Only the dev harness needs a refresh control of its own.
            ui.fab(canvas, w - ui.dp(34f), ui.dp(24f), CarUi.Icon.REFRESH) { onRefresh() }
        }

        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(76f), CarUi.Icon.LAYERS) {
            layersOpen = !layersOpen
            selected = null
            selectedDevice = null
            renderer.setHighlight(null)
        }
        ui.fab(canvas, w - ui.dp(34f), barBottom + ui.dp(128f), CarUi.Icon.LOCATE) {
            onLocate?.invoke()
        }

        // The card takes the bottom-left corner the legend lives in, so the
        // legend steps aside while one is open — as it does on the phone, where
        // the device card covers it.
        if (!layersOpen && selected == null && selectedDevice == null) {
            drawLegend(canvas, h)
            ui.label(canvas, subtitle(), ui.dp(10f), h - ui.dp(4f), ui.dp(11f), CarTheme.muted)
        }
        // Position readout sits top-left, where nothing else competes for it.
        whereAmI?.let { where ->
            val text = ui.clip(where.text, ui.dp(13f), w * 0.62f, bold = true)
            val box = RectF(ui.dp(8f), ui.dp(6f), ui.dp(16f) + w * 0.62f, ui.dp(34f))
            ui.card(canvas, box, if (where.warn) CarUi.OVERDUE_CARD else CarTheme.surface, ui.dp(8f))
            ui.block(box)
            ui.label(
                canvas, text, box.left + ui.dp(10f), box.centerY() + ui.dp(5f), ui.dp(13f),
                if (where.warn) CarTheme.occupied else CarTheme.onSurface, bold = true,
            )
        }
        selected?.let { drawHunterCard(canvas, w, h, it) }
        selectedDevice?.let { drawDeviceCard(canvas, w, h, it) }
        if (layersOpen) drawLayersPanel(canvas, w, h, barBottom)
        drawTabs(canvas, width, height)
    }

    private fun drawTabs(canvas: Canvas, width: Int, height: Int) {
        ui.tabBar(canvas, width, height, listOf("Mapa", "Polowania"), tab.ordinal) { index ->
            tab = if (index == 0) CarTab.MAP else CarTab.BOOK
            layersOpen = false
            selected = null
            selectedDevice = null
            renderer.setHighlight(null)
            if (tab == CarTab.BOOK) book.activate()
            onTabChanged?.invoke()
        }
    }

    /**
     * Koło name plus how old the occupancy is — the phone shows the unit name
     * and a DataAge chip in the same place. Once the car has fetched who is
     * hunting itself, that fetch is what the age refers to; before, it is the
     * phone's hand-over. A copy served from the offline cache says so.
     */
    private fun subtitle(): String {
        val unit = data.unit?.let { "$it · " } ?: ""
        val at = if (data.occupancyAt > 0) data.occupancyAt else data.updatedAt
        val age = if (at > 0) {
            val mins = (System.currentTimeMillis() - at) / 60000
            val ago = when {
                mins < 1 -> "przed chwilą"
                mins < 60 -> "$mins min temu"
                mins < 60 * 24 -> "${mins / 60} godz. temu"
                else -> "${mins / (60 * 24)} dni temu"
            }
            "dane: $ago" + if (data.occupancyOffline) " (offline)" else ""
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
        val rowH = ui.dp(19f)
        val rect = RectF(
            ui.dp(10f),
            h - ui.dp(30f) - types.size * rowH,
            ui.dp(132f),
            h - ui.dp(24f),
        )
        ui.card(canvas, rect, CarTheme.surface, ui.dp(10f))
        ui.block(rect)
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
        ui.block(rect)
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
        ui.block(rect)

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

        var y = rect.top + ui.dp(36f)
        val rowH = ui.dp(32f)
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
