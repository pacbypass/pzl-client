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

    /** The source named in a MapLibre error such as "… for source bdot10k: …".
     *  The snapshotter usually reports only "bitmap decoding: …" without it, so
     *  this is a fast path rather than something to rely on. */
    fun sourceFromError(error: String): String? =
        Regex("for source ([A-Za-z0-9_.:-]+)").find(error)?.groupValues?.getOrNull(1)

    /**
     * Raster source ids in the order the style draws them — base layer first,
     * overlays after (see `buildMapStyle`). Dropping from the END therefore
     * sheds overlays before the layer the map is actually built on.
     */
    fun rasterSources(styleJson: String): List<String> {
        val sources = JSONObject(styleJson).optJSONObject("sources") ?: return emptyList()
        val layers = JSONObject(styleJson).optJSONArray("layers") ?: return emptyList()
        val ordered = mutableListOf<String>()
        for (i in 0 until layers.length()) {
            val layer = layers.optJSONObject(i) ?: continue
            val id = layer.optString("source")
            if (id.isEmpty() || id in ordered) continue
            if (sources.optJSONObject(id)?.optString("type") == "raster") ordered.add(id)
        }
        return ordered
    }
}
