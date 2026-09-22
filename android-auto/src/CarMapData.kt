package com.smallgis.pzl.client.car

import android.content.Context
import android.graphics.Color
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng

/**
 * What the car screen needs to draw a map, handed over by the phone app.
 *
 * The STYLE IS NOT REBUILT HERE. `src/map/style.ts` already produces a complete
 * MapLibre style (raster base layers plus the obwody / rewiry / occupied /
 * device GeoJSON inlined), so the phone publishes that exact string and the car
 * renders it — one source of truth for what the map looks like, on both screens.
 */
data class CarMapData(
    val styleJson: String,
    val center: LatLng,
    val zoom: Double,
    val markers: List<CarMarker>,
    val updatedAt: Long,
)

object CarMapStore {

    private const val TAG = "CarMapStore"
    /** Written by the phone app; read by the car app. */
    const val FILE_NAME = "car-map.json"

    fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    fun read(context: Context): CarMapData? {
        val f = file(context)
        if (!f.exists()) return null
        return try {
            parse(JSONObject(f.readText()))
        } catch (e: Exception) {
            Log.w(TAG, "unreadable $FILE_NAME", e)
            null
        }
    }

    private fun parse(root: JSONObject): CarMapData {
        val cam = root.optJSONObject("camera")
        val markers = mutableListOf<CarMarker>()
        val arr: JSONArray = root.optJSONArray("markers") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            markers.add(
                CarMarker(
                    id = m.optString("id", i.toString()),
                    title = m.optString("title"),
                    subtitle = m.optString("subtitle"),
                    position = LatLng(m.optDouble("lat"), m.optDouble("lng")),
                    color = runCatching { Color.parseColor(m.optString("color", "#c62828")) }
                        .getOrDefault(Color.RED),
                ),
            )
        }
        return CarMapData(
            styleJson = root.getJSONObject("style").toString(),
            center = LatLng(cam?.optDouble("lat") ?: 52.0, cam?.optDouble("lng") ?: 19.4),
            zoom = cam?.optDouble("zoom") ?: 12.0,
            markers = markers,
            updatedAt = root.optLong("updatedAt"),
        )
    }

    /**
     * Stand-in used until the phone app has published anything — a plain OSM map
     * over Poland, so the car screen is never blank (and so the renderer can be
     * exercised before the bridge exists).
     */
    fun fallback(): CarMapData {
        val style = JSONObject(
            """
            {
              "version": 8,
              "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
              "sources": {
                "osm": {
                  "type": "raster",
                  "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                  "tileSize": 256,
                  "attribution": "© OpenStreetMap"
                }
              },
              "layers": [{ "id": "raster-osm", "type": "raster", "source": "osm" }]
            }
            """.trimIndent(),
        )
        return CarMapData(
            styleJson = style.toString(),
            center = LatLng(52.0, 19.4),
            zoom = 6.0,
            markers = emptyList(),
            updatedAt = 0L,
        )
    }

    fun readOrFallback(context: Context): CarMapData = read(context) ?: fallback()

    /**
     * What the phone currently has switched on, read back out of the published
     * style so the car's panel mirrors the phone's without keeping its own
     * settings. Vector overlays are named `geo-<key>` by `buildMapStyle`;
     * raster layers keep their plain key.
     */
    fun layerSummary(
        data: CarMapData,
        dropped: Set<String> = emptySet(),
    ): List<Triple<String, Boolean, Boolean>> {
        val names = listOf(
            "osm" to "OpenStreetMap",
            "orto" to "Ortofotomapa (GUGiK)",
            "bdl" to "Lasy Państwowe (BDL)",
            "cadastre" to "Ewidencja gruntów (KIEG)",
            "bdot10k" to "BDOT10k (topografia)",
            "geo-districts" to "Obwody łowieckie",
            "geo-rewirs" to "Rewiry",
            "geo-rewirs-occupied" to "Zajęte rewiry",
            "geo-devices" to "Urządzenia łowieckie",
        )
        val present = try {
            JSONObject(data.styleJson).optJSONObject("sources")?.keys()?.asSequence()?.toSet()
                ?: emptySet()
        } catch (e: Exception) {
            emptySet<String>()
        }
        // Triple(label, on, unavailable) — a layer the renderer had to drop is
        // shown but marked, rather than quietly missing.
        return names
            .filter { present.contains(it.first) || dropped.contains(it.first) }
            .map { (id, label) -> Triple(label, !dropped.contains(id), dropped.contains(id)) }
    }
}
