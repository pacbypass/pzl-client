package com.smallgis.pzl.client.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

class PzlSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = CarMapScreen(carContext)
}
