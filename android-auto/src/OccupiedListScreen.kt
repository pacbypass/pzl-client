package com.smallgis.pzl.client.car

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/**
 * "Kto gdzie poluje" as a list — safer to read at a glance than hunting for a
 * pin on the map. The host caps how many rows it will show while driving, so
 * the list is trimmed to whatever it allows.
 */
class OccupiedListScreen(
    carContext: CarContext,
    private val markers: List<CarMarker>,
) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val limit = carContext.getCarService(ConstraintManager::class.java)
            .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)

        val builder = ItemList.Builder()
        if (markers.isEmpty()) {
            builder.setNoItemsMessage("Żaden rewir nie jest teraz zajęty")
        } else {
            for (m in markers.take(limit)) {
                builder.addItem(
                    Row.Builder()
                        .setTitle(m.title)
                        .addText(m.subtitle)
                        .setOnClickListener { screenManager.push(HuntersScreen(carContext, m)) }
                        .build(),
                )
            }
        }

        return ListTemplate.Builder()
            .setTitle("Zajęte rewiry")
            .setHeaderAction(Action.BACK)
            .setSingleList(builder.build())
            .build()
    }
}
