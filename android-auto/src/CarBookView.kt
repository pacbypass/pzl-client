package com.smallgis.pzl.client.car

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import java.util.Locale

/**
 * "Polowania" — the książka ewidencji on the car screen.
 *
 * Same content and the same colour language as the phone's list (green card =
 * na polowaniu, red = po czasie, amber = pozyskanie), compressed to three lines
 * per entry because the head unit is 400px tall where the phone has 2400.
 *
 * The year picker is deliberately absent: in a car you want THIS season, so the
 * current hunting year is fixed and only the obwód can be changed.
 */
class CarBookView(
    private val context: Context,
    private val ui: CarUi,
    private val onChanged: () -> Unit,
) {
    private var districtId: String? = null
    private var districtLabel: String = "—"
    private var entries: List<CarApi.Entry> = emptyList()
    private var total = 0
    private var page = 0
    private var loading = false
    private var error: String? = null
    /** When the entries on screen were fetched; older than a minute or so and
     *  the header says as much, the way the phone's DataAge chip does. */
    private var fetchedAt = 0L
    private var offline = false
    private var scroll = 0f
    private var pickerOpen = false
    private var contentHeight = 0f
    private var viewportHeight = 0f

    private fun districts(): List<Pair<String, String>> =
        CarApi.access(context)?.districts ?: emptyList()

    fun activate() {
        if (districtId == null) {
            val first = districts().firstOrNull()
            districtId = first?.first
            districtLabel = first?.second ?: "—"
        }
        if (entries.isEmpty() && !loading) reload()
    }

    fun reload() {
        val id = districtId ?: districts().firstOrNull()?.first ?: return
        loading = true
        error = null
        page = 1
        CarApi.book(
            context, id, 1,
            onResult = { list, t, at, fromCache ->
                entries = list
                total = t
                fetchedAt = at
                // Say it plainly when the data did not come from the network,
                // however fresh the copy happens to be.
                offline = fromCache
                loading = false
                onChanged()
            },
            onError = { message ->
                // Keep whatever is already on screen; an empty list with an
                // error is worse than stale entries in the woods.
                error = message
                loading = false
                onChanged()
            },
        )
    }

    private fun loadMore() {
        val id = districtId ?: return
        if (loading || entries.size >= total) return
        loading = true
        val next = page + 1
        CarApi.book(
            context, id, next,
            onResult = { list, t, at, fromCache ->
                page = next
                total = t
                if (fromCache) offline = true
                // Dedupe: a page boundary can overlap when an entry is added.
                val seen = entries.map { it.id }.toSet()
                entries = entries + list.filter { it.id !in seen }
                loading = false
                onChanged()
            },
            onError = { message ->
                error = message
                loading = false
                onChanged()
            },
        )
    }

    fun onScroll(dy: Float) {
        if (pickerOpen) return
        val max = (contentHeight - viewportHeight).coerceAtLeast(0f)
        scroll = (scroll + dy).coerceIn(0f, max)
        // Same infinite scroll as the phone: pull the next page near the end.
        if (max > 0 && scroll > max - viewportHeight * 0.5f) loadMore()
        onChanged()
    }

    fun blocking(): Boolean = pickerOpen

    fun draw(canvas: Canvas, width: Int, height: Int, bottom: Float) {
        ui.page(canvas, width, height)
        val w = width.toFloat()

        val active = entries.count {
            it.status == CarApi.Status.ACTIVE || it.status == CarApi.Status.OVERDUE
        }

        // No app bar: on a 400px screen a title strip costs a whole entry. The
        // obwód chip doubles as the header, with the counts beside it.
        val barBottom = 0f
        val chip = RectF(ui.dp(8f), ui.dp(5f), ui.dp(130f), ui.dp(31f))
        ui.chip(canvas, chip, "Obwód $districtLabel") {
            pickerOpen = true
            onChanged()
        }
        val year = CarApi.access(context)?.year
        val stale = when {
            offline -> "offline · dane ${age()}"
            error != null && entries.isNotEmpty() -> "offline · dane ${age()}"
            else -> null
        }
        ui.label(
            canvas,
            listOfNotNull(
                year?.let { "$it-${it + 1}" },
                "$active na polowaniu",
                if (total > 0) "$total wpisów" else null,
                stale,
            ).joinToString(" · "),
            chip.right + ui.dp(10f),
            chip.centerY() + ui.dp(4f),
            ui.dp(12f),
            if (stale != null) CarTheme.harvest else CarTheme.muted,
        )

        val listTop = chip.bottom + ui.dp(4f)
        viewportHeight = bottom - listTop
        drawList(canvas, w, listTop, bottom)

        if (pickerOpen) drawPicker(canvas, w, height.toFloat(), barBottom)
    }

    private fun age(): String {
        if (fetchedAt <= 0L) return "z pamięci"
        val mins = (System.currentTimeMillis() - fetchedAt) / 60000
        return when {
            mins < 1 -> "sprzed chwili"
            mins < 60 -> "sprzed $mins min"
            mins < 60 * 24 -> "sprzed ${mins / 60} godz."
            else -> "sprzed ${mins / (60 * 24)} dni"
        }
    }

    private fun drawList(canvas: Canvas, w: Float, top: Float, bottom: Float) {
        // An error only takes the screen when there is nothing to show; with
        // entries in hand it is a note in the header instead.
        if (error != null && entries.isEmpty()) {
            ui.label(canvas, error!!, ui.dp(14f), top + ui.dp(22f), ui.dp(13f), CarTheme.occupied)
            return
        }
        if (entries.isEmpty()) {
            ui.label(
                canvas,
                if (loading) "Wczytywanie książki…" else "Brak wpisów",
                ui.dp(14f), top + ui.dp(22f), ui.dp(13f), CarTheme.muted,
            )
            return
        }

        val rowH = ui.dp(70f)
        val gap = ui.dp(6f)
        contentHeight = entries.size * (rowH + gap)

        canvas.save()
        canvas.clipRect(0f, top, w, bottom)
        var y = top - scroll
        for (entry in entries) {
            if (y + rowH >= top && y <= bottom) drawEntry(canvas, w, y, rowH, entry)
            y += rowH + gap
        }
        canvas.restore()
    }

    private fun drawEntry(canvas: Canvas, w: Float, y: Float, rowH: Float, e: CarApi.Entry) {
        val rect = RectF(ui.dp(10f), y, w - ui.dp(10f), y + rowH)
        val bg = when (e.status) {
            CarApi.Status.ACTIVE -> CarUi.ACTIVE_CARD
            CarApi.Status.OVERDUE -> CarUi.OVERDUE_CARD
            else -> CarUi.DONE_CARD
        }
        ui.card(canvas, rect, bg, ui.dp(10f))

        val label = when (e.status) {
            CarApi.Status.ACTIVE -> "Na polowaniu"
            CarApi.Status.OVERDUE -> "Po czasie"
            CarApi.Status.CROSSED -> "wykreślone"
            CarApi.Status.CLOSED -> "zakończone"
        }
        val labelColor = when (e.status) {
            CarApi.Status.ACTIVE -> CarTheme.green
            CarApi.Status.OVERDUE -> CarTheme.occupied
            else -> CarTheme.muted
        }
        ui.label(
            canvas, ui.clip(e.hunter, ui.dp(14f), w * 0.5f, bold = true),
            rect.left + ui.dp(10f), rect.top + ui.dp(20f), ui.dp(14f),
            CarTheme.onSurface, bold = true,
        )
        ui.label(
            canvas, label, rect.right - ui.dp(10f), rect.top + ui.dp(20f), ui.dp(12f),
            labelColor, bold = e.status == CarApi.Status.ACTIVE || e.status == CarApi.Status.OVERDUE,
            align = Paint.Align.RIGHT,
        )

        val times = buildString {
            append(fmt(e.start))
            append(" → ")
            append(
                if (e.status == CarApi.Status.ACTIVE || e.status == CarApi.Status.OVERDUE) "trwa"
                else fmt(e.end),
            )
        }
        val place = e.place.ifBlank { "—" }
        ui.label(
            canvas, ui.clip("$place · $times", ui.dp(12f), rect.width() - ui.dp(20f)),
            rect.left + ui.dp(10f), rect.top + ui.dp(42f), ui.dp(12f),
        )

        val harvest = if (e.harvest.isEmpty()) "Brak pozyskania" else e.harvest.joinToString(", ")
        val shots = e.shots?.let { " · strzały: $it" } ?: ""
        ui.label(
            canvas,
            ui.clip(harvest + shots, ui.dp(12f), rect.width() - ui.dp(90f), bold = e.harvest.isNotEmpty()),
            rect.left + ui.dp(10f), rect.top + ui.dp(62f), ui.dp(12f),
            if (e.harvest.isEmpty()) CarTheme.muted else CarTheme.harvest,
            bold = e.harvest.isNotEmpty(),
        )
        ui.label(
            canvas, "nr ${e.number}", rect.right - ui.dp(10f), rect.top + ui.dp(62f),
            ui.dp(11f), CarTheme.muted, align = Paint.Align.RIGHT,
        )
    }

    private fun drawPicker(canvas: Canvas, w: Float, h: Float, top: Float) {
        ui.scrim(canvas, w.toInt(), h.toInt()) {
            pickerOpen = false
            onChanged()
        }
        val list = districts()
        val rowH = ui.dp(36f)
        // Height must follow where the rows actually start (top + 28) or the
        // last obwód falls outside the card and never gets drawn.
        val cardTop = top + ui.dp(8f)
        val rect = RectF(
            w * 0.22f, cardTop, w * 0.78f,
            (cardTop + ui.dp(34f) + list.size * rowH + ui.dp(6f)).coerceAtMost(h - ui.dp(10f)),
        )
        ui.card(canvas, rect, CarTheme.surface)
        ui.label(
            canvas, "Obwód", rect.left + ui.dp(12f), rect.top + ui.dp(20f),
            ui.dp(14f), CarTheme.onSurface, bold = true,
        )
        var y = rect.top + ui.dp(28f)
        for ((id, label) in list) {
            if (y + rowH > rect.bottom) break
            ui.row(
                canvas,
                RectF(rect.left, y, rect.right, y + rowH),
                "Obwód $label",
                null,
                if (id == districtId) CarTheme.green else null,
            ) {
                districtId = id
                districtLabel = label
                pickerOpen = false
                entries = emptyList()
                scroll = 0f
                reload()
                onChanged()
            }
            y += rowH
        }
    }

    private fun fmt(iso: String?): String {
        if (iso == null) return "—"
        return try {
            val t = java.time.Instant.parse(if (iso.endsWith("Z") || iso.contains('+')) iso else iso + "Z")
                .atZone(java.time.ZoneId.systemDefault())
            String.format(Locale("pl"), "%02d.%02d, %02d:%02d",
                t.dayOfMonth, t.monthValue, t.hour, t.minute)
        } catch (e: Exception) {
            "—"
        }
    }
}
