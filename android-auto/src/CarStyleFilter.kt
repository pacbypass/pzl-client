package com.smallgis.pzl.client.car

import org.json.JSONArray
import org.json.JSONObject

/**
 * Drops sources (and the layers that draw them) from a MapLibre style.
 *
 * `MapSnapshotter` aborts the WHOLE snapshot when a single tile fails to
 * decode, unlike `MapView`, which simply skips the tile and carries on. One
 * flaky WMS overlay would therefore blank the entire car map, so the renderer
 * drops the offending source and tries again.
 */
object CarStyleFilter {

    fun without(styleJson: String, sources: Set<String>): String {
        if (sources.isEmpty()) return styleJson
        val root = JSONObject(styleJson)
        root.optJSONObject("sources")?.let { for (s in sources) it.remove(s) }
        val layers = root.optJSONArray("layers") ?: return root.toString()
        val kept = JSONArray()
        for (i in 0 until layers.length()) {
            val layer = layers.optJSONObject(i) ?: continue
            if (layer.optString("source") !in sources) kept.put(layer)
        }
        root.put("layers", kept)
        return root.toString()
    }

    /** The source named in a MapLibre error such as "… for source bdot10k: …". */
    fun sourceFromError(error: String): String? =
        Regex("for source ([A-Za-z0-9_.:-]+)").find(error)?.groupValues?.getOrNull(1)
}
