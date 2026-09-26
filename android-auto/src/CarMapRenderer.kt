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
 * A snapshot costs a few hundred ms, so gestures do not wait for one. The
 * camera moves at once, and whatever frames are in hand are drawn where that
 * camera puts them — shifted for a drag, scaled for a pinch — until a fresh
 * snapshot of the new camera lands. Every frame remembers the camera it was
 * rendered at, so a slow render arriving late slots in where it belongs
 * instead of dragging the view back to where it was when it started.
 *
 * Under the detailed frame sits a coarser one covering four times the span,
 * so zooming out or dragging far shows real (if blurry) map at the edges
 * rather than blank background.
 */
class CarMapRenderer(private val context: Context) {

    companion object {
        private const val TAG = "CarMapRenderer"
        /** Poland, so an unpositioned map still shows something sensible. */
        private val FALLBACK = LatLng(52.0, 19.4)
        /**
         * The map is rendered LARGER than the screen and the visible window is
         * blitted out of it. Panning then shows real map instead of empty edges
         * and only needs a fresh render once the drag approaches the margin,
         * which is what makes dragging feel immediate despite each snapshot
         * costing a few hundred milliseconds.
         */
        private const val OVERSCAN = 1.6f
        /** A render is slow, but not this slow; past this the latch is forced. */
        private const val WATCHDOG_MS = 12_000L
        private const val RETRY_MS = 4_000L
        /** Pinch settles before a render is worth starting. */
        private const val ZOOM_SETTLE_MS = 220L
        /** ~2.2MP, i.e. an 8.8MB frame, whatever the screen. */
        private const val MAX_BUFFER_PIXELS = 2_200_000f
        private const val MAX_AUTO_RETRIES = 3
        private const val MIN_ZOOM = 4.0
        private const val MAX_ZOOM = 17.0
        /** The backdrop frame is rendered this many zoom levels further out. */
        private const val CONTEXT_ZOOM_OUT = 2.0
        /** Quiet time after a drag before a fresh render starts. */
        private const val DRAG_SETTLE_MS = 250L
        /** While following, re-render at most this often (unless near the edge). */
        private const val FOLLOW_RENDER_MS = 2_500L
    }

    /** Size of the rendered bitmap (surface size × OVERSCAN). */
    private var bufferW = 0
    private var bufferH = 0

    /**
     * Where a rendered frame lands on screen for the CURRENT camera: the pixel
     * of the camera target inside the frame (cx, cy) goes to the screen centre,
     * scaled by how far the camera has zoomed since the frame was rendered.
     * Web Mercator pixels scale uniformly with zoom, so this is exact.
     */
    private inner class FrameView(val snapshot: MapSnapshot, zoom: Double) {
        val scale = Math.pow(2.0, camera.zoom - zoom).toFloat()
        private val t = snapshot.pixelForLatLng(camera.target ?: FALLBACK)
        val cx = t.x
        val cy = t.y

        fun toScreen(position: LatLng): PointF {
            val p = snapshot.pixelForLatLng(position)
            return PointF((p.x - cx) * scale + width / 2f, (p.y - cy) * scale + height / 2f)
        }

        fun toFrame(x: Float, y: Float) =
            PointF((x - width / 2f) / scale + cx, (y - height / 2f) / scale + cy)

        fun latLngAt(x: Float, y: Float): LatLng? = snapshot.latLngForPixel(toFrame(x, y))

        /** True once the visible window gets close to the frame's edge. */
        fun nearEdge(): Boolean {
            val slackX = (bufferW - width) * 0.15f
            val slackY = (bufferH - height) * 0.15f
            val halfW = width / 2f / scale
            val halfH = height / 2f / scale
            return cx - halfW < slackX || cx + halfW > snapshot.bitmap.width - slackX ||
                cy - halfH < slackY || cy + halfH > snapshot.bitmap.height - slackY
        }
    }

    private fun view(): FrameView? = lastSnapshot?.let { FrameView(it, snapZoom) }

    private val main = Handler(Looper.getMainLooper())
    private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
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

    /** Last rendered frame, redrawn under the camera while gestures move it. */
    private var lastSnapshot: MapSnapshot? = null
    private var lastBitmap: Bitmap? = null
    /** Zoom `lastSnapshot` was rendered at. */
    private var snapZoom = 0.0
    /** Coarse backdrop frame (see class doc) and its own renderer. */
    private var contextSnapshotter: MapSnapshotter? = null
    private var contextSnapshot: MapSnapshot? = null
    private var contextZoom = 0.0
    private var contextInFlight = false
    private var snapshotInFlight = false
    private var snapshotQueued = false
    /** Consecutive failures with nothing on screen. */
    private var failures = 0
    private var frames = 0L
    private var frameMs = 0L

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
        val resized = width != this.width || height != this.height
        this.surface = surface
        this.width = width
        this.height = height
        this.pixelRatio = (dpi / 160f).coerceAtLeast(1f)
        if (resized) {
            // Old frame belongs to a different geometry; keeping it would draw
            // the map and its pins at the wrong offsets.
            lastBitmap = null
            lastSnapshot = null
            contextSnapshot = null
        }
        failures = 0
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
        val canvas = lock(surface) ?: return
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
        main.removeCallbacks(renderSoon)
        renderDueAt = 0L
        main.removeCallbacks(watchdog)
        main.removeCallbacks(rebuildLater)
        snapshotInFlight = false
        snapshotQueued = false
        snapshotter?.cancel()
        snapshotter = null
        cancelContext()
        contextSnapshotter = null
        surface = null
        lastSnapshot = null
        lastBitmap = null
        contextSnapshot = null
    }

    /**
     * GPU canvas where the surface allows it: scaling a frame every gesture
     * step is what makes a drag or pinch feel smooth, and on the CPU that
     * costs tens of milliseconds a frame. Once a surface has been drawn one
     * way it cannot be locked the other, so the choice is made once.
     */
    private var hardwareCanvas: Boolean? = null

    private fun lock(surface: Surface): Canvas? {
        if (hardwareCanvas != false) {
            try {
                return surface.lockHardwareCanvas().also { hardwareCanvas = true }
            } catch (e: Throwable) {
                if (hardwareCanvas == true) {
                    Log.e(TAG, "lockHardwareCanvas failed", e)
                    return null
                }
                Log.w(TAG, "no hardware canvas, drawing on the CPU", e)
                hardwareCanvas = false
            }
        }
        return try {
            surface.lockCanvas(null)
        } catch (e: Throwable) {
            Log.e(TAG, "lockCanvas failed", e)
            null
        }
    }

    // ---- inputs ----------------------------------------------------------

    fun setStyle(json: String) {
        Log.i(TAG, "setStyle ${json.length}B")
        if (json == styleJsonFull) return
        styleJsonFull = json
        // Layers already found broken stay dropped: the car now re-publishes
        // the style every few minutes (fresh occupancy), and offline that
        // meant failing through every raster source all over again each time.
        // "Odśwież" still retries them (retryDroppedSources).
        styleJson = if (disabledSources.isEmpty()) {
            json
        } else {
            try {
                CarStyleFilter.without(json, disabledSources)
            } catch (e: Throwable) {
                Log.e(TAG, "could not filter style", e)
                disabledSources.clear()
                json
            }
        }
        if (snapshotter == null || contextSnapshotter == null) {
            rebuildSnapshotter()
            return
        }
        // Same size, same place: hand the renderers the new style and render
        // the view again, instead of tearing them down. A style change is
        // usually just fresh occupancy, every couple of minutes; rebuilding
        // for that cancelled whatever was rendering and started cold.
        styleDirty = true
        contextStyleDirty = true
        requestSnapshot()
    }

    /** The style changed since the renderer last loaded it (see setStyle). */
    private var styleDirty = false
    private var contextStyleDirty = false

    fun setCamera(target: LatLng, zoom: Double) {
        camera = CameraPosition.Builder().target(target).zoom(zoom).build()
        redrawLastFrame()
        requestSnapshot()
    }

    /** Metres of uncertainty on the current fix; drawn as a ring. */
    private var userAccuracy = 0f
    /** True when the fix is old enough that it should not be trusted. */
    private var userStale = false

    fun setUserAccuracy(metres: Float, stale: Boolean) {
        if (metres == userAccuracy && stale == userStale) return
        userAccuracy = metres
        userStale = stale
        redrawLastFrame()
    }

    fun setUserLocation(location: LatLng?) {
        val previous = userLocation
        userLocation = location
        // GPS ticks every few seconds; repainting for a metre of drift is work
        // for nothing.
        if (previous != null && location != null) {
            val moved = Math.hypot(
                (previous.latitude - location.latitude) * 111_000,
                (previous.longitude - location.longitude) * 70_000,
            )
            if (moved < 5) return
        }
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
        val view = view() ?: return null
        var best: CarDevice? = null
        var bestDist = tolerance
        for (d in devices) {
            val p = view.toScreen(d.position)
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
        val p = view()?.toScreen(position) ?: return Float.MAX_VALUE
        return Math.hypot((p.x - x).toDouble(), (p.y - y).toDouble()).toFloat()
    }

    /** Distance in pixels to the nearest rewir pin, for "which is closer" checks. */
    fun markerDistance(x: Float, y: Float, marker: CarMarker): Float =
        markerDistanceTo(x, y, marker.position)

    /** The taken rewir whose polygon contains this tap, if any. */
    fun shapeAt(x: Float, y: Float): CarMarker? {
        val at = view()?.latLngAt(x, y) ?: return null
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
     * Finger moved: the camera follows at once and the frames in hand are
     * redrawn under it. The car host has no "scroll finished" callback, so the
     * render of the new camera starts once the gesture has been quiet for a
     * moment — or straight away when the drag is about to run off the frame.
     */
    fun onDrag(dx: Float, dy: Float) {
        // Dragging the map away is how following ends, as on the phone.
        if (following) {
            following = false
            onFollowEnded?.invoke()
        }
        val view = view() ?: return
        val target = view.latLngAt(width / 2f - dx, height / 2f - dy) ?: return
        camera = CameraPosition.Builder().target(target).zoom(camera.zoom).build()
        redrawLastFrame()
        if (view().let { it == null || it.nearEdge() }) {
            // Running off the frame: render now-ish, and do not let the next
            // move event push it back, or a long drag never renders at all.
            scheduleRender(60, postpone = false)
        } else {
            scheduleRender(DRAG_SETTLE_MS)
        }
    }

    /** Kept for callers that report the end of a drag; the render is already due. */
    fun onDragEnd() = scheduleRender(0)

    /**
     * Follow mode: the view stays centred on the driver. Set by the session;
     * a drag ends it (and reports so), a pinch zooms about the driver.
     */
    var following = false
    var onFollowEnded: (() -> Unit)? = null

    /**
     * Keep the driver in the middle while following. The camera moves at once
     * (the frame in hand slides under it), and a fresh render follows at most
     * every couple of seconds — at driving speed the frame's margin lasts far
     * longer than that — or straight away when the view nears its edge.
     */
    fun followTo(target: LatLng) {
        val current = camera.target
        if (current != null && current.latitude == target.latitude &&
            current.longitude == target.longitude
        ) {
            return
        }
        camera = CameraPosition.Builder().target(target).zoom(camera.zoom).build()
        redrawLastFrame()
        val edge = view().let { it == null || it.nearEdge() }
        scheduleRender(if (edge) 0 else FOLLOW_RENDER_MS, postpone = false)
    }

    private val renderSoon = Runnable {
        renderDueAt = 0L
        requestSnapshot()
    }
    /** When `renderSoon` is due, or 0 when none is pending. */
    private var renderDueAt = 0L

    /**
     * Debounced by default: each call pushes the render back, so it starts
     * once the gesture goes quiet. With `postpone = false` a render already
     * due sooner is left alone.
     */
    private fun scheduleRender(delayMs: Long, postpone: Boolean = true) {
        val due = android.os.SystemClock.uptimeMillis() + delayMs
        if (!postpone && renderDueAt != 0L && renderDueAt <= due) return
        main.removeCallbacks(renderSoon)
        renderDueAt = due
        main.postAtTime(renderSoon, due)
    }

    fun onZoom(factor: Float) = onZoomAt(width / 2f, height / 2f, factor)

    /**
     * Pinch keeps the point under the fingers put, instead of always zooming on
     * the middle of the screen — the map moves the way it does on the phone.
     * The host reports a negative focus when it has none (zoom buttons, the
     * rotary knob); those zoom on the middle.
     */
    fun onZoomAt(focusX: Float, focusY: Float, factor: Float) {
        if (factor <= 0f || factor.isNaN()) return
        // While following, zoom about the driver (the middle) so they stay put.
        val fx = if (following || focusX < 0f || focusX > width) width / 2f else focusX
        val fy = if (following || focusY < 0f || focusY > height) height / 2f else focusY
        val zoom = (camera.zoom + Math.log(factor.toDouble()) / Math.log(2.0))
            .coerceIn(MIN_ZOOM, MAX_ZOOM)
        val view = view()
        if (view == null) {
            setCamera(camera.target ?: FALLBACK, zoom)
            return
        }
        // The spot under the fingers, in frame pixels, stays under the fingers
        // at the new scale; the target is whatever then lands mid-screen.
        val focus = view.toFrame(fx, fy)
        val scale = Math.pow(2.0, zoom - snapZoom).toFloat()
        val target = view.snapshot.latLngForPixel(
            PointF(focus.x - (fx - width / 2f) / scale, focus.y - (fy - height / 2f) / scale),
        ) ?: return
        camera = CameraPosition.Builder().target(target).zoom(zoom).build()
        redrawLastFrame()
        // A pinch fires many scale events, and rendering on each one means
        // waiting on map tiles over and over; render once the fingers settle.
        scheduleRender(ZOOM_SETTLE_MS)
    }

    /** Which marker (if any) sits under a tap, within `tolerance` pixels. */
    fun markerAt(x: Float, y: Float, tolerance: Float = 44f): CarMarker? {
        val view = view() ?: return null
        var best: CarMarker? = null
        var bestDist = tolerance
        for (m in markers) {
            val p = view.toScreen(m.position)
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
        if (surface == null) {
            // Detached: a late retry must not bring two snapshotters (and
            // their tile fetches and frame buffers) back for a screen that
            // is gone. attach() rebuilds.
            Log.i(TAG, "rebuildSnapshotter: detached, skipping")
            return
        }
        Log.i(TAG, "rebuildSnapshotter style=${json.length}B camera=${camera.target}/${camera.zoom}")
        // A cancelled snapshotter never calls back, so the latch has to be
        // cleared here. Leaving it set wedged the renderer permanently: every
        // later request just queued itself and the map froze — white, if the
        // surface had been recreated in the meantime.
        snapshotter?.cancel()
        snapshotInFlight = false
        snapshotQueued = false
        main.removeCallbacks(watchdog)
        // A 1.6x buffer on a 1920x1080 head unit would be a 21MB bitmap per
        // frame; capped by pixel budget so the overscan shrinks instead of the
        // app dying on a big screen.
        val overscan = run {
            val wanted = width.toFloat() * height * OVERSCAN * OVERSCAN
            if (wanted <= MAX_BUFFER_PIXELS) OVERSCAN
            else Math.sqrt((MAX_BUFFER_PIXELS / (width.toFloat() * height)).toDouble())
                .toFloat().coerceAtLeast(1f)
        }
        bufferW = (width * overscan).toInt()
        bufferH = (height * overscan).toInt()
        Log.i(TAG, "buffer ${bufferW}x$bufferH (overscan ${"%.2f".format(overscan)})")
        val options = MapSnapshotter.Options(bufferW, bufferH)
            .withStyleJson(json)
            .withCameraPosition(camera)
            .withPixelRatio(1f) // the surface is already in device pixels
            .withLogo(false)
        snapshotter = MapSnapshotter(context, options)
        styleDirty = false
        contextStyleDirty = false
        cancelContext()
        contextSnapshotter = MapSnapshotter(
            context,
            MapSnapshotter.Options(bufferW, bufferH)
                .withStyleJson(json)
                .withCameraPosition(contextCamera())
                .withPixelRatio(1f)
                .withLogo(false),
        )
        requestSnapshot()
    }

    /** Last resort: a render that never calls back must not freeze the map. */
    private val watchdog = Runnable {
        if (snapshotInFlight) {
            Log.w(TAG, "snapshot did not return in ${WATCHDOG_MS}ms — cancelling it")
            // A snapshotter that is still busy throws if started again, which
            // took the whole car app down on a slow connection. Cancelling
            // clears it for reuse; tiles it already fetched stay cached.
            try {
                snapshotter?.cancel()
            } catch (e: Throwable) {
                Log.e(TAG, "cancel failed", e)
            }
            snapshotInFlight = false
            snapshotQueued = false
            requestSnapshot()
        }
    }

    private fun requestSnapshot() {
        main.removeCallbacks(renderSoon)
        renderDueAt = 0L
        val snapshotter = snapshotter ?: return
        if (snapshotInFlight) {
            // Coalesce: one more render once the current one lands.
            snapshotQueued = true
            return
        }
        // The backdrop can wait; the frame the user is looking at cannot.
        cancelContext()
        snapshotInFlight = true
        // Set here and only here: moving the camera of a render already under
        // way would leave no telling which camera the frame belongs to.
        val rendering = camera
        if (styleDirty) {
            // Only between renders: a style swapped under a running render
            // would leave no telling which style the frame shows.
            styleDirty = false
            snapshotter.setStyleJson(styleJson ?: styleJsonFull ?: "")
        }
        snapshotter.setCameraPosition(rendering)
        val startedAt = android.os.SystemClock.uptimeMillis()
        main.removeCallbacks(watchdog)
        main.postDelayed(watchdog, WATCHDOG_MS)
        snapshotter.start({ snapshot ->
            snapshotInFlight = false
            main.removeCallbacks(watchdog)
            failures = 0
            status = null
            lastSnapshot = snapshot
            lastBitmap = snapshot.bitmap
            // Read the zoom off the frame itself rather than trusting the
            // request: a render started straight after another can come back
            // at once with the PREVIOUS camera, and drawing that as the new
            // zoom put the map somewhere else entirely.
            snapZoom = zoomOf(snapshot)
            val centre = snapshot.pixelForLatLng(rendering.target ?: FALLBACK)
            val stale = Math.abs(snapZoom - rendering.zoom) > 0.02 ||
                Math.abs(centre.x - snapshot.bitmap.width / 2f) > 2f ||
                Math.abs(centre.y - snapshot.bitmap.height / 2f) > 2f
            Log.i(
                TAG,
                "snapshot ready ${snapshot.bitmap.width}x${snapshot.bitmap.height} " +
                    "in ${android.os.SystemClock.uptimeMillis() - startedAt}ms " +
                    "zoom ${"%.2f".format(snapZoom)}/${"%.2f".format(rendering.zoom)}" +
                    if (stale) " STALE" else "",
            )
            if (stale && staleRetries < 3) {
                staleRetries++
                snapshotQueued = true
            } else if (!stale) {
                staleRetries = 0
            }
            // Drawn against the camera as it is NOW, which may have moved on
            // while this rendered; the frame lands where it belongs.
            redrawLastFrame()
            failuresWithFrame = 0
            if (snapshotQueued) {
                snapshotQueued = false
                scheduleRender(0)
            } else {
                renderContextIfNeeded()
            }
        }, { error ->
            snapshotInFlight = false
            main.removeCallbacks(watchdog)
            Log.e(TAG, "snapshot failed: $error")
            if (!retryWithout(error)) {
                // Keep the last good frame if there is one; a stale map beats
                // none. With nothing to show, keep trying rather than sitting
                // on a blank screen.
                if (lastBitmap == null) {
                    failures++
                    status = if (failures >= MAX_AUTO_RETRIES) {
                        "Mapa niedostępna — dotknij Odśwież"
                    } else {
                        "Wczytywanie mapy…"
                    }
                    drawStatus()
                    if (failures < MAX_AUTO_RETRIES) {
                        main.removeCallbacks(rebuildLater)
                        main.postDelayed(rebuildLater, RETRY_MS)
                    }
                } else if (failuresWithFrame < MAX_AUTO_RETRIES) {
                    // A frame is on screen, but not of where the user has
                    // moved to — and a render they asked for while this one
                    // ran was queued behind it. Dropping both left the old
                    // frame, shifted, with blank edges until the next touch.
                    // Try again after a pause; bounded, so a render that
                    // always fails does not spin.
                    failuresWithFrame++
                    snapshotQueued = false
                    scheduleRender(RETRY_MS / 2 * failuresWithFrame)
                } else {
                    snapshotQueued = false
                }
            }
        })
    }

    /** Consecutive failed renders while an older frame stays on screen. */
    private var failuresWithFrame = 0

    /** Named so detach() can take it back: a rebuild must not outlive the screen. */
    private val rebuildLater = Runnable { rebuildSnapshotter() }

    private var staleRetries = 0

    /**
     * Zoom a frame was actually rendered at, from its own projection: the
     * world is 512 × 2^zoom pixels wide, so a known pixel span and the
     * longitude it covers give the zoom.
     */
    private fun zoomOf(snapshot: MapSnapshot): Double {
        val y = snapshot.bitmap.height / 2f
        val span = snapshot.bitmap.width / 2f
        val a = snapshot.latLngForPixel(PointF(snapshot.bitmap.width / 4f, y))
        val b = snapshot.latLngForPixel(PointF(snapshot.bitmap.width / 4f + span, y))
        val degrees = Math.abs(b.longitude - a.longitude)
        if (degrees <= 0.0 || degrees.isNaN()) return camera.zoom
        return Math.log(360.0 * span / (degrees * 512.0)) / Math.log(2.0)
    }

    private fun contextCamera(): CameraPosition = CameraPosition.Builder()
        .target(camera.target ?: FALLBACK)
        .zoom((camera.zoom - CONTEXT_ZOOM_OUT).coerceAtLeast(0.0))
        .build()

    /**
     * Render the backdrop once the view is idle, unless the one in hand still
     * surrounds the view comfortably at about the right scale.
     */
    private fun renderContextIfNeeded() {
        val ctx = contextSnapshotter ?: return
        if (contextInFlight || snapshotInFlight) return
        val wanted = contextCamera()
        contextSnapshot?.let { current ->
            val t = current.pixelForLatLng(camera.target ?: FALLBACK)
            val centred = Math.abs(t.x - current.bitmap.width / 2f) < current.bitmap.width / 8f &&
                Math.abs(t.y - current.bitmap.height / 2f) < current.bitmap.height / 8f
            if (!contextStyleDirty && centred && Math.abs(contextZoom - wanted.zoom) < 0.75) return
        }
        contextInFlight = true
        if (contextStyleDirty) {
            contextStyleDirty = false
            ctx.setStyleJson(styleJson ?: styleJsonFull ?: "")
        }
        ctx.setCameraPosition(wanted)
        ctx.start({ snapshot ->
            contextInFlight = false
            contextSnapshot = snapshot
            contextZoom = zoomOf(snapshot)
            redrawLastFrame()
        }, { error ->
            // Only a backdrop: the detailed frame reports what matters.
            contextInFlight = false
            Log.w(TAG, "backdrop snapshot failed: $error")
        })
    }

    private fun cancelContext() {
        if (!contextInFlight) return
        contextInFlight = false
        try {
            contextSnapshotter?.cancel()
        } catch (e: Throwable) {
            Log.e(TAG, "backdrop cancel failed", e)
        }
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
        main.removeCallbacks(rebuildLater)
        main.post(rebuildLater)
        return true
    }

    private fun redrawLastFrame() {
        if (lastBitmap == null) {
            drawStatus()
            return
        }
        drawFrame()
    }

    /** Repaint after the chrome changed (a panel opened, a card was closed). */
    fun redraw() = redrawLastFrame()

    /**
     * Give up on the layers that were dropped and render the full style again.
     * Offline, every raster source fails and gets dropped one by one until only
     * the vector data is left — which is the right thing to show in the woods —
     * but those layers must come back once there is signal, and a refresh with
     * an unchanged style would otherwise be a no-op.
     */
    fun retryDroppedSources() {
        if (disabledSources.isEmpty()) return
        Log.i(TAG, "retrying ${disabledSources.size} dropped source(s)")
        disabledSources.clear()
        styleJson = styleJsonFull
        rebuildSnapshotter()
    }

    private fun drawFrame() {
        val surface = surface ?: return
        if (!surface.isValid) return
        val frame = lastSnapshot ?: return
        val canvas = lock(surface) ?: return
        val startedAt = android.os.SystemClock.uptimeMillis()
        try {
            canvas.drawColor(Color.rgb(0xE6, 0xED, 0xE1))
            contextSnapshot?.let { drawSnapshot(canvas, FrameView(it, contextZoom)) }
            val view = FrameView(frame, snapZoom)
            drawSnapshot(canvas, view)
            drawOverlays(canvas, view)
            overlay?.invoke(canvas, width, height)
        } finally {
            surface.unlockCanvasAndPost(canvas)
        }
        val took = android.os.SystemClock.uptimeMillis() - startedAt
        frames++
        frameMs += took
        if (frames % 20L == 0L) {
            Log.i(TAG, "draw: ${frameMs / frames}ms avg over $frames frames (last ${took}ms)")
        }
    }

    private fun drawSnapshot(canvas: Canvas, view: FrameView) {
        canvas.save()
        canvas.translate(width / 2f, height / 2f)
        canvas.scale(view.scale, view.scale)
        canvas.translate(-view.cx, -view.cy)
        canvas.drawBitmap(view.snapshot.bitmap, 0f, 0f, bitmapPaint)
        canvas.restore()
    }

    /**
     * Pins and the user puck go on with a plain Canvas — no style round-trip.
     * They keep their size through a pinch, as on the phone; only where they
     * sit follows the map.
     */
    private fun drawOverlays(canvas: Canvas, view: FrameView) {
        for (m in markers) {
            val p = view.toScreen(m.position)
            markerPaint.color = m.color
            canvas.drawCircle(p.x, p.y, 14f, markerPaint)
            canvas.drawCircle(p.x, p.y, 14f, strokePaint)
        }
        highlight?.let {
            // Selection ring, as the phone draws around a tapped device.
            val p = view.toScreen(it)
            strokePaint.color = Color.rgb(0x15, 0x65, 0xC0)
            strokePaint.strokeWidth = 3f
            canvas.drawCircle(p.x, p.y, 15f, strokePaint)
            strokePaint.color = Color.WHITE
            strokePaint.strokeWidth = 4f
        }
        userLocation?.let {
            val p = view.toScreen(it)
            // Accuracy ring: a ±40m fix next to a rewir boundary should LOOK
            // like one, rather than a confident dot on the wrong side of it.
            if (userAccuracy > 1f) {
                val north = view.toScreen(
                    LatLng(it.latitude + userAccuracy / 111_320.0, it.longitude),
                )
                val radius = Math.abs(p.y - north.y)
                if (radius > 2f) {
                    markerPaint.color = Color.argb(40, 0x15, 0x65, 0xC0)
                    canvas.drawCircle(p.x, p.y, radius, markerPaint)
                    strokePaint.color = Color.argb(90, 0x15, 0x65, 0xC0)
                    strokePaint.strokeWidth = 2f
                    canvas.drawCircle(p.x, p.y, radius, strokePaint)
                    strokePaint.color = Color.WHITE
                    strokePaint.strokeWidth = 4f
                }
            }
            markerPaint.color =
                if (userStale) Color.rgb(0x90, 0x9C, 0xA6) else Color.rgb(0x15, 0x65, 0xC0)
            canvas.drawCircle(p.x, p.y, 12f, markerPaint)
            canvas.drawCircle(p.x, p.y, 12f, strokePaint)
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
    /**
     * Every `obwód|REWIR` this marker may be known by. Rewir labels repeat
     * across obwody, and the book and the map layer do not always number
     * obwody the same way, so a polygon is matched against all of them.
     */
    val keys: List<String> = listOf(id),
)
