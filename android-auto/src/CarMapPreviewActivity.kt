package com.smallgis.pzl.client.car

import android.app.Activity
import android.os.Bundle
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ScaleGestureDetector

/**
 * DEV HARNESS — the car renderer on a plain `SurfaceView`, so it can be checked
 * on an ordinary phone/emulator without a head unit:
 *
 *   adb shell am start -n com.smallgis.pzl.client/.car.CarMapPreviewActivity
 *
 * It is not in the launcher and nothing in the app links to it; the phone app
 * is unaffected. Delete once the car side is settled.
 */
class CarMapPreviewActivity : Activity(), SurfaceHolder.Callback {

    private lateinit var renderer: CarMapRenderer
    private lateinit var scale: ScaleGestureDetector
    private var lastX = 0f
    private var lastY = 0f

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderer = CarMapRenderer(this)
        val view = SurfaceView(this)
        view.holder.addCallback(this)
        setContentView(view)
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
        val data = CarMapStore.readOrFallback(this)
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
            }
            MotionEvent.ACTION_MOVE -> if (!scale.isInProgress) {
                renderer.onDrag(event.x - lastX, event.y - lastY)
                lastX = event.x
                lastY = event.y
            }
        }
        return true
    }
}
