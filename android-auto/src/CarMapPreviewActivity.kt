package com.smallgis.pzl.client.car

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ScaleGestureDetector
import android.widget.FrameLayout

/**
 * DEV HARNESS — the car renderer on a plain `SurfaceView`, so it can be checked
 * on an ordinary phone/emulator without a head unit:
 *
 *   adb shell am start -n com.smallgis.pzl.client/.car.CarMapPreviewActivity
 *
 * Pass the head unit's size to lay the chrome out exactly as the car will
 * (a real Android Auto screen reported 800x400):
 *
 *   adb shell am start -n com.smallgis.pzl.client/.car.CarMapPreviewActivity \
 *     --ei w 800 --ei h 400
 *
 * It is not in the launcher and nothing in the app links to it; the phone app
 * is unaffected. Delete once the car side is settled.
 */
class CarMapPreviewActivity : Activity(), SurfaceHolder.Callback {

    private lateinit var renderer: CarMapRenderer
    private lateinit var chrome: CarMapChrome
    private lateinit var location: CarLocation
    private lateinit var session: CarMapSession
    private lateinit var scale: ScaleGestureDetector
    private var downX = 0f
    private var downY = 0f
    private var dragged = false
    private var lastX = 0f
    private var lastY = 0f

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderer = CarMapRenderer(this)
        location = CarLocation(this)
        chrome = CarMapChrome(
            this,
            renderer,
            onRefresh = { session.refresh() },
            onLocate = { location.current?.let { renderer.setCamera(it, 14.0) } },
            showRefresh = true,
        )
        session = CarMapSession(this, renderer, chrome, location)
        location.start()
        session.start()
        renderer.overlay = { canvas, w, h -> chrome.draw(canvas, w, h) }
        val view = SurfaceView(this)
        view.holder.addCallback(this)
        // Touch must be handled ON the surface view: Activity.onTouchEvent
        // reports WINDOW coordinates, and the surface is letterboxed inside the
        // window, so those would not line up with what the renderer drew. The
        // car host hands us surface-relative coordinates, and so does this.
        view.setOnTouchListener { _, event -> handleTouch(event) }
        if (intent.getBooleanExtra("relogin", false)) {
            // --ez relogin true: exercise the car's own sign-in against the
            // live server, instead of waiting for the token to age out.
            CarApi.signInNow(this) { token ->
                android.util.Log.i(
                    "CarMapPreview",
                    if (token != null) "car sign-in OK (token ${token.length} chars)"
                    else "car sign-in FAILED",
                )
            }
        }
        if (intent.getBooleanExtra("zoomtest", false)) {
            // adb cannot inject a two-finger pinch, so drive the same code the
            // host's onScale calls: a burst of scale steps, then silence.
            val handler = android.os.Handler(android.os.Looper.getMainLooper())
            for (i in 1..10) {
                handler.postDelayed({
                    // Off-centre, as fingers usually are: the spot under
                    // them must stay put through the whole pinch.
                    renderer.onZoomAt(600f, 150f, if (i <= 5) 1.12f else 0.94f)
                    android.util.Log.i("CarMapPreview", "pinch step $i")
                }, 3000L + i * 70L)
            }
            handler.postDelayed({
                android.util.Log.i("CarMapPreview", "pinch settled at zoom ${renderer.camera().zoom}")
            }, 4500L)
        }
        val w = intent.getIntExtra("w", 0)
        val h = intent.getIntExtra("h", 0)
        if (w > 0 && h > 0) {
            // Letterbox to the head unit's aspect so the layout is what the car gets.
            view.holder.setFixedSize(w, h)
            val frame = FrameLayout(this)
            frame.setBackgroundColor(Color.BLACK)
            frame.addView(
                view,
                FrameLayout.LayoutParams(w, h, Gravity.CENTER),
            )
            setContentView(frame)
        } else {
            setContentView(view)
        }
        scale = ScaleGestureDetector(
            this,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    renderer.onZoom(detector.scaleFactor)
                    return true
                }
            },
        )
    }

    override fun surfaceCreated(holder: SurfaceHolder) = Unit

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        renderer.attach(holder.surface, width, height, resources.displayMetrics.densityDpi)
        session.load()
    }

    override fun onDestroy() {
        session.stop()
        location.stop()
        super.onDestroy()
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        renderer.detach()
    }

    private fun handleTouch(event: MotionEvent): Boolean {
        scale.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = event.x
                lastY = event.y
                downX = event.x
                downY = event.y
                dragged = false
            }
            MotionEvent.ACTION_MOVE -> if (!scale.isInProgress) {
                if (Math.hypot((event.x - downX).toDouble(), (event.y - downY).toDouble()) > 12) {
                    dragged = true
                }
                if (dragged) {
                    // Book tab scrolls; map tab pans.
                    if (!chrome.onScroll(lastY - event.y) && !chrome.blockingGesture()) {
                        renderer.onDrag(event.x - lastX, event.y - lastY)
                    }
                }
                lastX = event.x
                lastY = event.y
            }
            MotionEvent.ACTION_UP -> if (!dragged) {
                // Same routing as the car: chrome first, then the map's markers.
                chrome.tap(event.x, event.y)
                renderer.redraw()
            }
        }
        return true
    }
}
