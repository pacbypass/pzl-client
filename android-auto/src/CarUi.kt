package com.smallgis.pzl.client.car

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface

/**
 * The phone app's look, drawn by hand onto the car surface.
 *
 * The car screen has no view system and the host's templates cannot express the
 * app's layout, so the chrome (app bar, buttons, cards, panels) is painted with
 * a Canvas over the rendered map. Colours and shapes mirror
 * `src/theme/theme.ts` and the Paper components used on the phone, so the two
 * screens read as the same app.
 */
object CarTheme {
    val green = Color.rgb(0x2F, 0x6B, 0x26)          // brand.green / primary
    val greenSurface = Color.rgb(0xEA, 0xF3, 0xE6)   // primaryContainer
    val surface = Color.WHITE
    val surfaceVariant = Color.rgb(0xE6, 0xED, 0xE1)
    val background = Color.rgb(0xF6, 0xF8, 0xF4)
    val onSurface = Color.rgb(0x1C, 0x1B, 0x1F)
    val muted = Color.rgb(0x6B, 0x6A, 0x6E)
    val occupied = Color.rgb(0xC6, 0x28, 0x28)       // taken rewir / "po czasie"
    val harvest = Color.rgb(0xA3, 0x52, 0x00)
    val scrim = Color.argb(0x66, 0, 0, 0)
}

/** A rectangle the user can tap, rebuilt every frame. */
private class Hotspot(val rect: RectF, val onTap: () -> Unit)

class CarUi {

    private val hotspots = mutableListOf<Hotspot>()

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.LEFT }

    /** Scale everything from the surface height, so a 400px car screen and a
     *  phone screen both end up proportionate. */
    var scale = 1f
        private set

    fun begin(width: Int, height: Int) {
        hotspots.clear()
        scale = (height / 400f).coerceIn(0.75f, 3f)
    }

    fun dp(v: Float) = v * scale

    /** Returns true when the tap hit a control (so the map should ignore it). */
    fun tap(x: Float, y: Float): Boolean {
        // Last drawn wins: panels are drawn over the map and must take the tap.
        for (h in hotspots.asReversed()) {
            if (h.rect.contains(x, y)) {
                h.onTap()
                return true
            }
        }
        return false
    }

    private fun hotspot(rect: RectF, onTap: () -> Unit) = hotspots.add(Hotspot(rect, onTap))

    // ---- primitives ------------------------------------------------------

    private fun shadow(canvas: Canvas, rect: RectF, radius: Float) {
        fill.color = Color.argb(0x22, 0, 0, 0)
        canvas.drawRoundRect(
            RectF(rect.left, rect.top + dp(2f), rect.right, rect.bottom + dp(2f)),
            radius, radius, fill,
        )
    }

    fun card(canvas: Canvas, rect: RectF, color: Int = CarTheme.surface, radius: Float = dp(16f)) {
        shadow(canvas, rect, radius)
        fill.color = color
        canvas.drawRoundRect(rect, radius, radius, fill)
    }

    fun label(
        canvas: Canvas,
        value: String,
        x: Float,
        y: Float,
        size: Float,
        color: Int = CarTheme.onSurface,
        bold: Boolean = false,
        align: Paint.Align = Paint.Align.LEFT,
    ) {
        text.color = color
        text.textSize = size
        text.textAlign = align
        text.typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        canvas.drawText(value, x, y, text)
    }

    /** Trims with an ellipsis so long hunter names cannot overrun a card. */
    fun clip(value: String, size: Float, maxWidth: Float, bold: Boolean = false): String {
        text.textSize = size
        text.typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        if (text.measureText(value) <= maxWidth) return value
        var end = value.length
        while (end > 1 && text.measureText(value.substring(0, end) + "…") > maxWidth) end--
        return value.substring(0, end) + "…"
    }

    // ---- components ------------------------------------------------------

    /** The map screen's app bar: title, subtitle and a refresh button. */
    fun appBar(
        canvas: Canvas,
        width: Int,
        title: String,
        subtitle: String?,
        /** Null in the car: the host paints its action strip over that corner,
         *  so refresh lives there instead of underneath it. */
        onRefresh: (() -> Unit)? = null,
    ): Float {
        val h = dp(52f)
        fill.color = CarTheme.background
        canvas.drawRect(0f, 0f, width.toFloat(), h, fill)
        fill.color = Color.argb(0x18, 0, 0, 0)
        canvas.drawRect(0f, h, width.toFloat(), h + dp(1f), fill)

        label(canvas, title, dp(16f), h * 0.45f, dp(20f), CarTheme.onSurface, bold = true)
        subtitle?.let {
            label(canvas, clip(it, dp(12f), width * 0.5f), dp(16f), h * 0.78f, dp(12f), CarTheme.muted)
        }

        onRefresh?.let {
            val r = dp(16f)
            val cx = width - dp(28f)
            val cy = h / 2f
            iconRefresh(canvas, cx, cy, r * 0.62f, CarTheme.green)
            hotspot(RectF(cx - r, cy - r, cx + r, cy + r), it)
        }
        return h
    }

    /** Round contained button, like the map screen's FABs. */
    fun fab(canvas: Canvas, cx: Float, cy: Float, icon: Icon, onTap: () -> Unit) {
        val r = dp(22f)
        shadow(canvas, RectF(cx - r, cy - r, cx + r, cy + r), r)
        fill.color = CarTheme.greenSurface
        canvas.drawCircle(cx, cy, r, fill)
        when (icon) {
            Icon.LAYERS -> iconLayers(canvas, cx, cy, r * 0.55f, CarTheme.green)
            Icon.LOCATE -> iconLocate(canvas, cx, cy, r * 0.55f, CarTheme.green)
            Icon.CLOSE -> iconClose(canvas, cx, cy, r * 0.5f, CarTheme.green)
            Icon.REFRESH -> iconRefresh(canvas, cx, cy, r * 0.55f, CarTheme.green)
        }
        hotspot(RectF(cx - r, cy - r, cx + r, cy + r), onTap)
    }

    /** A bare icon with a tap target — for close buttons inside cards, where a
     *  filled FAB would shout over the content. */
    fun iconButton(canvas: Canvas, cx: Float, cy: Float, icon: Icon, color: Int = CarTheme.muted, onTap: () -> Unit) {
        val r = dp(9f)
        when (icon) {
            Icon.CLOSE -> iconClose(canvas, cx, cy, r, color)
            Icon.LAYERS -> iconLayers(canvas, cx, cy, r, color)
            Icon.LOCATE -> iconLocate(canvas, cx, cy, r, color)
            Icon.REFRESH -> iconRefresh(canvas, cx, cy, r, color)
        }
        val touch = dp(18f)
        hotspot(RectF(cx - touch, cy - touch, cx + touch, cy + touch), onTap)
    }

    fun checkboxRow(
        canvas: Canvas,
        rect: RectF,
        text: String,
        checked: Boolean,
        onTap: () -> Unit,
    ) {
        val box = dp(16f)
        val cx = rect.left + dp(14f)
        val cy = rect.centerY()
        val boxRect = RectF(cx - box / 2, cy - box / 2, cx + box / 2, cy + box / 2)
        if (checked) {
            fill.color = CarTheme.green
            canvas.drawRoundRect(boxRect, dp(3f), dp(3f), fill)
            stroke.color = Color.WHITE
            stroke.strokeWidth = dp(2f)
            val p = Path().apply {
                moveTo(boxRect.left + box * 0.22f, cy)
                lineTo(cx - box * 0.02f, boxRect.bottom - box * 0.26f)
                lineTo(boxRect.right - box * 0.18f, boxRect.top + box * 0.26f)
            }
            canvas.drawPath(p, stroke)
        } else {
            stroke.color = CarTheme.muted
            stroke.strokeWidth = dp(1.6f)
            canvas.drawRoundRect(boxRect, dp(3f), dp(3f), stroke)
        }
        label(
            canvas,
            clip(text, dp(13f), rect.width() - dp(40f)),
            cx + dp(16f),
            cy + dp(4.5f),
            dp(13f),
        )
        hotspot(RectF(rect), onTap)
    }

    /** A row in a list panel: title plus an optional second line. */
    fun row(
        canvas: Canvas,
        rect: RectF,
        title: String,
        subtitle: String?,
        dotColor: Int? = null,
        onTap: (() -> Unit)? = null,
    ) {
        var x = rect.left + dp(12f)
        dotColor?.let {
            fill.color = it
            canvas.drawCircle(x + dp(6f), rect.centerY(), dp(6f), fill)
            stroke.color = Color.WHITE
            stroke.strokeWidth = dp(1.5f)
            canvas.drawCircle(x + dp(6f), rect.centerY(), dp(6f), stroke)
            x += dp(20f)
        }
        val w = rect.right - x - dp(10f)
        if (subtitle == null) {
            label(canvas, clip(title, dp(14f), w, bold = true), x, rect.centerY() + dp(5f), dp(14f), bold = true)
        } else {
            label(canvas, clip(title, dp(14f), w, bold = true), x, rect.centerY() - dp(2f), dp(14f), bold = true)
            label(canvas, clip(subtitle, dp(12f), w), x, rect.centerY() + dp(14f), dp(12f), CarTheme.muted)
        }
        onTap?.let { hotspot(RectF(rect), it) }
    }

    /** One line of the device legend: colour dot plus the type name. */
    fun legendRow(canvas: Canvas, x: Float, y: Float, label: String, color: Int) {
        fill.color = color
        canvas.drawCircle(x + dp(4f), y - dp(4f), dp(4f), fill)
        label(canvas, clip(label, dp(11f), dp(96f)), x + dp(13f), y, dp(11f))
    }

    fun scrim(canvas: Canvas, width: Int, height: Int, onTap: () -> Unit) {
        fill.color = CarTheme.scrim
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
        hotspot(RectF(0f, 0f, width.toFloat(), height.toFloat()), onTap)
    }

    // ---- icons (drawn, since there are no drawables on this surface) -----

    enum class Icon { LAYERS, LOCATE, CLOSE, REFRESH }

    private fun iconLayers(canvas: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        fill.color = color
        for ((i, dy) in listOf(-r * 0.55f, r * 0.15f, r * 0.75f).withIndex()) {
            val p = Path().apply {
                moveTo(cx, cy + dy - r * 0.5f)
                lineTo(cx + r, cy + dy)
                lineTo(cx, cy + dy + r * 0.5f)
                lineTo(cx - r, cy + dy)
                close()
            }
            if (i == 0) canvas.drawPath(p, fill) else {
                stroke.color = color
                stroke.strokeWidth = r * 0.22f
                canvas.drawPath(p, stroke)
            }
        }
    }

    private fun iconLocate(canvas: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        stroke.color = color
        stroke.strokeWidth = r * 0.25f
        canvas.drawCircle(cx, cy, r * 0.55f, stroke)
        canvas.drawLine(cx, cy - r, cx, cy - r * 0.75f, stroke)
        canvas.drawLine(cx, cy + r * 0.75f, cx, cy + r, stroke)
        canvas.drawLine(cx - r, cy, cx - r * 0.75f, cy, stroke)
        canvas.drawLine(cx + r * 0.75f, cy, cx + r, cy, stroke)
        fill.color = color
        canvas.drawCircle(cx, cy, r * 0.18f, fill)
    }

    private fun iconClose(canvas: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        stroke.color = color
        stroke.strokeWidth = r * 0.3f
        canvas.drawLine(cx - r, cy - r, cx + r, cy + r, stroke)
        canvas.drawLine(cx + r, cy - r, cx - r, cy + r, stroke)
    }

    private fun iconRefresh(canvas: Canvas, cx: Float, cy: Float, r: Float, color: Int) {
        stroke.color = color
        stroke.strokeWidth = r * 0.28f
        val oval = RectF(cx - r, cy - r, cx + r, cy + r)
        canvas.drawArc(oval, -40f, 280f, false, stroke)
        fill.color = color
        val p = Path().apply {
            moveTo(cx + r * 0.95f, cy - r * 0.95f)
            lineTo(cx + r * 1.05f, cy - r * 0.05f)
            lineTo(cx + r * 0.15f, cy - r * 0.5f)
            close()
        }
        canvas.drawPath(p, fill)
    }
}
