package com.smallgis.pzl.client.car

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/** Who is signed up in one rewir. */
class HuntersScreen(
    carContext: CarContext,
    private val marker: CarMarker,
) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val pane = Pane.Builder()
        val lines = marker.subtitle.split("\n").filter { it.isNotBlank() }
        if (lines.isEmpty()) {
            pane.addRow(Row.Builder().setTitle("Brak szczegółów").build())
        } else {
            for (line in lines) {
                pane.addRow(Row.Builder().setTitle(line).build())
            }
        }
        return PaneTemplate.Builder(pane.build())
            .setTitle(marker.title)
            .setHeaderAction(Action.BACK)
            .build()
    }
}
