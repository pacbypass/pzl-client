package com.smallgis.pzl.client.car

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.snapshotter.MapSnapshot
import org.maplibre.android.snapshotter.MapSnapshotter

/**
 * Draws the hunting map onto a bare `Surface` — the car screen has no View
 * hierarchy, so MapLibre's MapView cannot be used. Instead the map is rendered
 * OFF-SCREEN by `MapSnapshotter` (the same engine, the same style JSON the
 * phone app builds) and the resulting bitmap is blitted to the surface.
 *
 * A snapshot costs a few hundred ms, so dragging does not re-render: the last
 * bitmap is blitted at an offset while the finger moves and a fresh snapshot is
 * requested once the gesture settles. That keeps panning responsive without a
 * live GL context.
 */
class CarMapRenderer(private val context: Context) {

    companion object {
        private const val TAG = "CarMapRenderer"
        /** Poland, so an unpositioned map still shows something sensible. */
        private val FALLBACK = LatLng(52.0, 19.4)
    }

    private val main = Handler(Looper.getMainLooper())
    private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.WHITE
        strokeWidth = 4f
    }

    private var surface: Surface? = null
    private var width = 0
    private var height = 0
    private var pixelRatio = 1f

    private var snapshotter: MapSnapshotter? = null
    private var styleJson: String? = null
    /** The style as published, before any failing sources were dropped. */
    private var styleJsonFull: String? = null
    /** Sources whose tiles the snapshotter could not decode. */
    private val disabledSources = mutableSetOf<String>()
    private var camera = CameraPosition.Builder().target(FALLBACK).zoom(6.0).build()

    /** Last rendered frame, kept so a drag can blit it at an offset. */
    private var lastSnapshot: MapSnapshot? = null
    private var lastBitmap: Bitmap? = null
    private var dragX = 0f
    private var dragY = 0f
    private var snapshotInFlight = false
    private var snapshotQueued = false

    /** User position, drawn on top of the map when known. */
    private var userLocation: LatLng? = null
    /** Points the car app can tap — the middle of every taken rewir. */
    private var markers: List<CarMarker> = emptyList()
    /** Devices are drawn by the style; these are kept for hit testing. */
    private var devices: List<CarDevice> = emptyList()
    /** Outlines of the taken rewiry, so a tap inside one counts. */
    private var shapes: List<CarShape> = emptyList()
    /** Ring drawn around whatever the user last selected. */
    private var highlight: LatLng? = null

    /**
     * The app's chrome, painted over the map every frame: app bar, buttons,
     * cards, panels. Supplied by the screen so the renderer stays about pixels.
     */
    var overlay: ((Canvas, Int, Int) -> Unit)? = null

    // ---- lifecycle -------------------------------------------------------

    fun attach(surface: Surface, width: Int, height: Int, dpi: Int) {
        Log.i(TAG, "attach ${width}x$height dpi=$dpi valid=${surface.isValid}")
        try {
            MapLibre.getInstance(context)
        } catch (e: Throwable) {
            Log.e(TAG, "MapLibre init failed", e)
            status = "Błąd inicjalizacji mapy"
        }
        this.surface = surface
        this.width = width
        this.height = height
        this.pixelRatio = (dpi / 160f).coerceAtLeast(1f)
        // Paint immediately: until the first snapshot lands the car screen would
        // otherwise stay empty, which is indistinguishable from a broken surface.
        drawStatus()
        rebuildSnapshotter()
    }

    /** Shown until the first snapshot arrives, and whenever one fails. */
    private var status: String? = "Ładowanie mapy…"

    private val statusPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(0x2f, 0x6b, 0x26)
        textSize = 34f
        textAlign = Paint.Align.CENTER
    }

    private fun drawStatus() {
        val surface = surface ?: return
        if (!surface.isValid) {
            Log.w(TAG, "drawStatus: surface not valid")
            return
        }
        val canvas = try {
            surface.lockCanvas(null)
        } catch (e: Throwable) {
            Log.e(TAG, "drawStatus lockCanvas failed", e)
            return
        }
        try {
            canvas.drawColor(Color.rgb(0xF6, 0xF8, 0xF4))
            status?.let {
                canvas.drawText(it, width / 2f, height / 2f, statusPaint)
            }
            overlay?.invoke(canvas, width, height)
        } finally {
            surface.unlockCanvasAndPost(canvas)
        }
    }

    fun detach() {
        main.removeCallbacks(commitDrag)
        snapshotter?.cancel()
        snapshotter = null
        surface = null
        lastSnapshot = null
        lastBitmap = null
    }

    // ---- inputs ----------------------------------------------------------

    fun setStyle(json: String) {
        Log.i(TAG, "setStyle ${json.length}B")
        if (json == styleJsonFull) return
        styleJsonFull = json
        disabledSources.clear()
        styleJson = json
        rebuildSnapshotter()
    }

    fun setCamera(target: LatLng, zoom: Double) {
        camera = CameraPosition.Builder().target(target).zoom(zoom).build()
        snapshotter?.setCameraPosition(camera)
        requestSnapshot()
    }

    fun setUserLocation(location: LatLng?) {
        userLocation = location
        redrawLastFrame()
    }

    fun setMarkers(markers: List<CarMarker>) {
        this.markers = markers
        redrawLastFrame()
    }

    fun setDevices(devices: List<CarDevice>) {
        this.devices = devices
    }

    fun setShapes(shapes: List<CarShape>) {
        this.shapes = shapes
    }

    fun setHighlight(position: LatLng?) {
        highlight = position
        redrawLastFrame()
    }

    /** Nearest device to a tap, as the phone's map does it. */
    fun deviceAt(x: Float, y: Float, tolerance: Float = 34f): CarDevice? {
        val snapshot = lastSnapshot ?: return null
        var best: CarDevice? = null
        var bestDist = tolerance
        for (d in devices) {
            val p = snapshot.pixelForLatLng(d.position)
            val dist = Math.hypot((p.x - x).toDouble(), (p.y - y).toDouble()).toFloat()
            if (dist < bestDist) {
                bestDist = dist
                best = d
            }
        }
        return best
    }

    /** Pixel distance to any position, for "which is closer" checks. */
    fun markerDistanceTo(x: Float, y: Float, position: LatLng): Float {
        val snapshot = lastSnapshot ?: return Float.MAX_VALUE
        val p = snapshot.pixelForLatLng(position)
        return Math.hypot((p.x - x).toDouble(), (p.y - y).toDouble()).toFloat()
    }

    /** Distance in pixels to the nearest rewir pin, for "which is closer" checks. */
    fun markerDistance(x: Float, y: Float, marker: CarMarker): Float {
        val snapshot = lastSnapshot ?: return Float.MAX_VALUE
        val p = snapshot.pixelForLatLng(marker.position)
        return Math.hypot((p.x - x).toDouble(), (p.y - y).toDouble()).toFloat()
    }

    /** The taken rewir whose polygon contains this tap, if any. */
    fun shapeAt(x: Float, y: Float): CarMarker? {
        val snapshot = lastSnapshot ?: return null
        val at = snapshot.latLngForPixel(PointF(x, y)) ?: return null
        for (shape in shapes) {
            if (CarMapStore.contains(shape, at.longitude, at.latitude)) {
                return markers.firstOrNull { it.id == shape.markerId }
            }
        }
        return null
    }

    fun camera(): CameraPosition = camera

    /** Raster sources dropped because their tiles would not decode. */
    fun droppedSources(): Set<String> = disabledSources.toSet()

    // ---- gestures --------------------------------------------------------

    /**
     * Finger moved: shift the last frame, no re-render yet. The car host has no
     * "scroll finished" callback, so the real camera move is committed once the
     * gesture has been quiet for a moment.
     */
    fun onDrag(dx: Float, dy: Float) {
        dragX += dx
        dragY += dy
        redrawLastFrame()
        main.removeCallbacks(commitDrag)
        main.postDelayed(commitDrag, 160)
    }

    private val commitDrag = Runnable { onDragEnd() }

    /** Finger lifted: turn the accumulated shift into a real camera move. */
    fun onDragEnd() {
        val snapshot = lastSnapshot
        if (snapshot == null || (dragX == 0f && dragY == 0f)) {
            dragX = 0f; dragY = 0f
            return
        }
        // The pixel under the screen centre AFTER the drag becomes the new centre.
        val target = snapshot.latLngForPixel(
            PointF(width / 2f - dragX, height / 2f - dragY),
        )
        dragX = 0f
        dragY = 0f
        setCamera(target, camera.zoom)
    }

    fun onZoom(factor: Float) = onZoomAt(width / 2f, height / 2f, factor)

    /**
     * Pinch keeps the point under the fingers put, instead of always zooming on
     * the middle of the screen — the map moves the way it does on the phone.
     */
    fun onZoomAt(focusX: Float, focusY: Float, factor: Float) {
        val zoom = (camera.zoom + Math.log(factor.toDouble()) / Math.log(2.0))
            .coerceIn(4.0, 17.0)
        val snapshot = lastSnapshot
        val k = Math.pow(2.0, zoom - camera.zoom).toFloat()
        if (snapshot == null || k <= 0f || Math.abs(k - 1f) < 0.001f) {
            setCamera(camera.target ?: FALLBACK, zoom)
            return
        }
        val cx = width / 2f
        val cy = height / 2f
        val target = snapshot.latLngForPixel(
            PointF(cx + (focusX - cx) * (1f - 1f / k), cy + (focusY - cy) * (1f - 1f / k)),
        ) ?: camera.target ?: FALLBACK
        setCamera(target, zoom)
    }

    /** Which marker (if any) sits under a tap, within `tolerance` pixels. */
    fun markerAt(x: Float, y: Float, tolerance: Float = 44f): CarMarker? {
        val snapshot = lastSnapshot ?: return null
        var best: CarMarker? = null
        var bestDist = tolerance
        for (m in markers) {
            val p = snapshot.pixelForLatLng(m.position)
            val d = Math.hypot((p.x - x).toDouble(), (p.y - y).toDouble()).toFloat()
            if (d < bestDist) {
                bestDist = d
                best = m
            }
        }
        return best
    }

    // ---- rendering -------------------------------------------------------

    private fun rebuildSnapshotter() {
        val json = styleJson
        if (json == null) {
            Log.w(TAG, "rebuildSnapshotter: no style yet")
            return
        }
        if (width <= 0 || height <= 0) {
            Log.w(TAG, "rebuildSnapshotter: no size yet ($width x $height)")
            return
        }
        Log.i(TAG, "rebuildSnapshotter style=${json.length}B camera=${camera.target}/${camera.zoom}")
        snapshotter?.cancel()
        val options = MapSnapshotter.Options(width, height)
            .withStyleJson(json)
            .withCameraPosition(camera)
            .withPixelRatio(1f) // the surface is already in device pixels
            .withLogo(false)
        snapshotter = MapSnapshotter(context, options)
        requestSnapshot()
    }

    private fun requestSnapshot() {
        val snapshotter = snapshotter ?: return
        if (snapshotInFlight) {
            // Coalesce: one more render once the current one lands.
            snapshotQueued = true
            return
        }
        snapshotInFlight = true
        snapshotter.start({ snapshot ->
            snapshotInFlight = false
            status = null
            lastSnapshot = snapshot
            lastBitmap = snapshot.bitmap
            Log.i(TAG, "snapshot ready ${snapshot.bitmap.width}x${snapshot.bitmap.height}")
            drawFrame(snapshot.bitmap, 0f, 0f)
            if (snapshotQueued) {
                snapshotQueued = false
                main.post { requestSnapshot() }
            }
        }, { error ->
            snapshotInFlight = false
            Log.e(TAG, "snapshot failed: $error")
            if (!retryWithout(error)) {
                // Keep the last good frame if there is one; a stale map beats none.
                if (lastBitmap == null) {
                    status = "Nie udało się wczytać mapy"
                    drawStatus()
                }
            }
        })
    }

    /**
     * A tile that will not decode aborts the whole snapshot, and the error the
     * snapshotter hands back names no source ("bitmap decoding: couldn't get
     * bitmap info"), so the bad raster layer is found by elimination: drop one
     * raster source and re-render, last one first, which sheds overlays before
     * the base layer the map is built on. Bounded by the number of raster
     * sources, so this always terminates.
     */
    private fun retryWithout(error: String): Boolean {
        val full = styleJsonFull ?: return false
        val named = CarStyleFilter.sourceFromError(error)
        val rasters = try {
            CarStyleFilter.rasterSources(full)
        } catch (e: Throwable) {
            Log.e(TAG, "could not read style sources", e)
            return false
        }
        val victim = named?.takeIf { it !in disabledSources }
            ?: rasters.lastOrNull { it !in disabledSources }
            ?: return false
        disabledSources.add(victim)
        Log.w(TAG, "dropping raster source '$victim' (tiles would not decode) and retrying")
        styleJson = try {
            CarStyleFilter.without(full, disabledSources)
        } catch (e: Throwable) {
            Log.e(TAG, "could not filter style", e)
            return false
        }
        main.post { rebuildSnapshotter() }
        return true
    }

    private fun redrawLastFrame() {
        val bitmap = lastBitmap
        if (bitmap == null) {
            drawStatus()
            return
        }
        drawFrame(bitmap, dragX, dragY)
    }

    /** Repaint after the chrome changed (a panel opened, a card was closed). */
    fun redraw() = redrawLastFrame()

    private fun drawFrame(bitmap: Bitmap, offsetX: Float, offsetY: Float) {
        val surface = surface ?: return
        if (!surface.isValid) return
        val canvas: Canvas = try {
            surface.lockCanvas(null)
        } catch (e: Throwable) {
            Log.e(TAG, "lockCanvas failed", e)
            return
        }
        try {
            canvas.drawColor(Color.rgb(0xE6, 0xED, 0xE1))
            canvas.drawBitmap(bitmap, offsetX, offsetY, null)
            drawOverlays(canvas, offsetX, offsetY)
            overlay?.invoke(canvas, width, height)
        } finally {
            surface.unlockCanvasAndPost(canvas)
        }
    }

    /** Pins and the user puck go on with a plain Canvas — no style round-trip. */
    private fun drawOverlays(canvas: Canvas, offsetX: Float, offsetY: Float) {
        val snapshot = lastSnapshot ?: return
        for (m in markers) {
            val p = snapshot.pixelForLatLng(m.position)
            val x = p.x + offsetX
            val y = p.y + offsetY
            markerPaint.color = m.color
            canvas.drawCircle(x, y, 14f, markerPaint)
            canvas.drawCircle(x, y, 14f, strokePaint)
        }
        highlight?.let {
            // Selection ring, as the phone draws around a tapped device.
            val p = snapshot.pixelForLatLng(it)
            strokePaint.color = Color.rgb(0x15, 0x65, 0xC0)
            strokePaint.strokeWidth = 3f
            canvas.drawCircle(p.x + offsetX, p.y + offsetY, 15f, strokePaint)
            strokePaint.color = Color.WHITE
            strokePaint.strokeWidth = 4f
        }
        userLocation?.let {
            val p = snapshot.pixelForLatLng(it)
            val x = p.x + offsetX
            val y = p.y + offsetY
            markerPaint.color = Color.rgb(0x15, 0x65, 0xC0)
            canvas.drawCircle(x, y, 12f, markerPaint)
            canvas.drawCircle(x, y, 12f, strokePaint)
        }
    }

    /** Size of the surface, for callers that need to centre things. */
    fun size(): Rect = Rect(0, 0, width, height)
}

/** A tappable point on the car map — one per taken rewir. */
data class CarMarker(
    val id: String,
    val title: String,
    val subtitle: String,
    val position: LatLng,
    val color: Int,
)
