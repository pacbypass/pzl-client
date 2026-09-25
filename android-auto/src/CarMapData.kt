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
    /** Koło name, shown in the app bar exactly as on the phone. */
    val unit: String? = null,
    /** Hunting devices, read back out of the published style. */
    val devices: List<CarDevice> = emptyList(),
    /** Outlines of the taken rewiry, so a tap anywhere inside one works. */
    val occupiedShapes: List<CarShape> = emptyList(),
    /** Every rewir of the koło, not only the taken ones. */
    val rewirs: List<CarRewir> = emptyList(),
)

/** An ambona / zwyżka / paśnik …, as the phone's device card shows it. */
data class CarDevice(
    val name: String,
    val type: String,
    val number: String?,
    val color: Int,
    val position: LatLng,
)

/** A rewir outline with its name, for "which rewir am I in". */
data class CarRewir(
    val name: String,
    val districtId: String,
    val rings: List<List<DoubleArray>>,
)

/** A polygon that belongs to a marker, for tap-anywhere hit testing. */
data class CarShape(
    val markerId: String,
    /** Rings of [lng, lat] pairs. */
    val rings: List<List<DoubleArray>>,
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
        val style = root.getJSONObject("style")
        return CarMapData(
            styleJson = style.toString(),
            center = LatLng(cam?.optDouble("lat") ?: 52.0, cam?.optDouble("lng") ?: 19.4),
            zoom = cam?.optDouble("zoom") ?: 12.0,
            markers = markers,
            updatedAt = root.optLong("updatedAt"),
            unit = root.optString("unit").takeIf { it.isNotBlank() && it != "null" },
            devices = devicesFrom(style),
            occupiedShapes = shapesFrom(style, markers),
            rewirs = rewirsFrom(style),
        )
    }

    /** Devices are already in the style (`geo-devices`), with the name, type
     *  and colour the phone draws them with — no second copy is published. */
    private fun devicesFrom(style: JSONObject): List<CarDevice> {
        val out = mutableListOf<CarDevice>()
        val fc = style.optJSONObject("sources")?.optJSONObject("geo-devices")
            ?.optJSONObject("data") ?: return out
        val features = fc.optJSONArray("features") ?: return out
        for (i in 0 until features.length()) {
            val f = features.optJSONObject(i) ?: continue
            val coords = f.optJSONObject("geometry")?.optJSONArray("coordinates") ?: continue
            if (coords.length() < 2) continue
            val props = f.optJSONObject("properties") ?: JSONObject()
            out.add(
                CarDevice(
                    name = props.optString("name").ifBlank { "Urządzenie" },
                    type = props.optString("type"),
                    number = props.optString("number").takeIf { it.isNotBlank() && it != "null" },
                    color = runCatching { Color.parseColor(props.optString("color")) }
                        .getOrDefault(Color.DKGRAY),
                    position = LatLng(coords.optDouble(1), coords.optDouble(0)),
                ),
            )
        }
        return out
    }

    /** Outlines of the taken rewiry, matched to their marker by rewir label, so
     *  tapping inside the red area opens the same card as tapping the pin. */
    private fun shapesFrom(style: JSONObject, markers: List<CarMarker>): List<CarShape> {
        val out = mutableListOf<CarShape>()
        val fc = style.optJSONObject("sources")?.optJSONObject("geo-rewirs-occupied")
            ?.optJSONObject("data") ?: return out
        val features = fc.optJSONArray("features") ?: return out
        for (i in 0 until features.length()) {
            val f = features.optJSONObject(i) ?: continue
            val name = f.optJSONObject("properties")?.optString("name") ?: continue
            val marker = markers.firstOrNull {
                it.title.removePrefix("Rewir ").trim().equals(name.trim(), ignoreCase = true)
            } ?: continue
            val geometry = f.optJSONObject("geometry") ?: continue
            val rings = mutableListOf<List<DoubleArray>>()
            when (geometry.optString("type")) {
                "Polygon" -> geometry.optJSONArray("coordinates")?.let { polygon ->
                    for (r in 0 until polygon.length()) {
                        ring(polygon.optJSONArray(r))?.let(rings::add)
                    }
                }
                "MultiPolygon" -> geometry.optJSONArray("coordinates")?.let { multi ->
                    for (p in 0 until multi.length()) {
                        val polygon = multi.optJSONArray(p) ?: continue
                        for (r in 0 until polygon.length()) {
                            ring(polygon.optJSONArray(r))?.let(rings::add)
                        }
                    }
                }
            }
            if (rings.isNotEmpty()) out.add(CarShape(marker.id, rings))
        }
        return out
    }

    /** Outlines of every rewir the phone published (source `geo-rewirs`). */
    private fun rewirsFrom(style: JSONObject): List<CarRewir> {
        val out = mutableListOf<CarRewir>()
        val fc = style.optJSONObject("sources")?.optJSONObject("geo-rewirs")
            ?.optJSONObject("data") ?: return out
        val features = fc.optJSONArray("features") ?: return out
        for (i in 0 until features.length()) {
            val f = features.optJSONObject(i) ?: continue
            val props = f.optJSONObject("properties") ?: continue
            val rings = ringsOf(f.optJSONObject("geometry"))
            if (rings.isNotEmpty()) {
                out.add(
                    CarRewir(
                        name = props.optString("name"),
                        districtId = props.optString("districtId"),
                        rings = rings,
                    ),
                )
            }
        }
        return out
    }

    private fun ringsOf(geometry: JSONObject?): List<List<DoubleArray>> {
        val rings = mutableListOf<List<DoubleArray>>()
        if (geometry == null) return rings
        when (geometry.optString("type")) {
            "Polygon" -> geometry.optJSONArray("coordinates")?.let { polygon ->
                for (r in 0 until polygon.length()) ring(polygon.optJSONArray(r))?.let(rings::add)
            }
            "MultiPolygon" -> geometry.optJSONArray("coordinates")?.let { multi ->
                for (p in 0 until multi.length()) {
                    val polygon = multi.optJSONArray(p) ?: continue
                    for (r in 0 until polygon.length()) ring(polygon.optJSONArray(r))?.let(rings::add)
                }
            }
        }
        return rings
    }

    /** Which rewir contains this point, if any. */
    fun rewirAt(data: CarMapData, lng: Double, lat: Double): CarRewir? =
        data.rewirs.firstOrNull { rewir ->
            rewir.rings.any { ring -> inside(ring, lng, lat) }
        }

    private fun inside(ring: List<DoubleArray>, lng: Double, lat: Double): Boolean {
        var result = false
        var j = ring.size - 1
        for (i in ring.indices) {
            val xi = ring[i][0]; val yi = ring[i][1]
            val xj = ring[j][0]; val yj = ring[j][1]
            if ((yi > lat) != (yj > lat) &&
                lng < (xj - xi) * (lat - yi) / ((yj - yi).takeIf { it != 0.0 } ?: 1e-12) + xi
            ) {
                result = !result
            }
            j = i
        }
        return result
    }

    private fun ring(arr: JSONArray?): List<DoubleArray>? {
        if (arr == null || arr.length() < 3) return null
        val pts = ArrayList<DoubleArray>(arr.length())
        for (i in 0 until arr.length()) {
            val p = arr.optJSONArray(i) ?: continue
            pts.add(doubleArrayOf(p.optDouble(0), p.optDouble(1)))
        }
        return pts.takeIf { it.size >= 3 }
    }

    /** Is a point inside any ring of this shape? (ray casting, lng/lat space) */
    fun contains(shape: CarShape, lng: Double, lat: Double): Boolean {
        for (ring in shape.rings) {
            var inside = false
            var j = ring.size - 1
            for (i in ring.indices) {
                val xi = ring[i][0]; val yi = ring[i][1]
                val xj = ring[j][0]; val yj = ring[j][1]
                if ((yi > lat) != (yj > lat) &&
                    lng < (xj - xi) * (lat - yi) / ((yj - yi).takeIf { it != 0.0 } ?: 1e-12) + xi
                ) {
                    inside = !inside
                }
                j = i
            }
            if (inside) return true
        }
        return false
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
