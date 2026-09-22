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
    private lateinit var scale: ScaleGestureDetector
    private var downX = 0f
    private var downY = 0f
    private var dragged = false
    private var lastX = 0f
    private var lastY = 0f

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderer = CarMapRenderer(this)
        chrome = CarMapChrome(renderer, onRefresh = { reload() })
        renderer.overlay = { canvas, w, h -> chrome.draw(canvas, w, h) }
        val view = SurfaceView(this)
        view.holder.addCallback(this)
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
        reload()
    }

    private fun reload() {
        val data = CarMapStore.readOrFallback(this)
        chrome.data = data
        chrome.reset()
        renderer.setStyle(data.styleJson)
        renderer.setMarkers(data.markers)
        renderer.setCamera(data.center, data.zoom)
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        renderer.detach()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
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
                if (!chrome.blockingGesture() && dragged) {
                    renderer.onDrag(event.x - lastX, event.y - lastY)
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
