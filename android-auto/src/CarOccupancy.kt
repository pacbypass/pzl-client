package com.smallgis.pzl.client.car

import android.content.Context
import android.graphics.Color
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng

/**
 * "Kto teraz poluje" worked out by the car itself.
 *
 * The phone only hands occupancy over while its map tab is open, so a car
 * running with the phone in a pocket showed whatever was true when the phone
 * last looked — "22 hours ago" in practice. This is a straight port of the
 * phone's rules (`src/features/map/occupied.ts`, `isOpenHunt` / `rewirNames` /
 * `normalizeRewir` / `huntStatus` / `isUpcoming` in
 * `src/features/huntingBook/book.ts`); keep the two in step.
 *
 * The rewir outlines come from the style the phone published (sources
 * `geo-rewirs` and `geo-rewirs-occupied`), since the car has no geometry of
 * its own; occupancy is then painted back into that style.
 *
 * A failed fetch never reads as "nobody is hunting": each obwód falls back to
 * its last good answer (kept on disk for the woods), and when nothing at all
 * can be had the caller keeps what it already shows.
 */
object CarOccupancy {

    private const val TAG = "CarOccupancy"
    private const val CACHE_FILE = "car-occupancy.json"
    /** Same limits as the phone: at most this many pages per obwód… */
    private const val MAX_PAGES = 3
    /** …and stop once a page has nothing touched in the last two weeks. */
    private const val LOOKBACK_MS = 14L * 24 * 60 * 60 * 1000
    const val OCCUPIED_COLOR = "#c62828"
    private const val OCCUPIED_SOURCE = "geo-rewirs-occupied"
    private const val MARKER_SOURCE = "geo-occupied-markers"

    /** What the car shows once occupancy is worked out. */
    data class Applied(
        val styleJson: String,
        val markers: List<CarMarker>,
        val shapes: List<CarShape>,
        /** Oldest obwód answer used — the honest age of the whole picture. */
        val fetchedAt: Long,
        /** At least one obwód came from the offline copy. */
        val offline: Boolean,
    )

    private data class Hunter(
        val name: String,
        val start: String?,
        val overdue: Boolean,
        val upcoming: Boolean,
    )

    private class Rewir(
        val name: String,
        val key: String,
        val districtId: String,
        val districtLabel: String,
        val districtKeys: MutableList<String>,
        val hunters: MutableList<Hunter>,
    )

    /** A rewir outline from the published style. */
    private class Outline(
        val name: String,
        val key: String,
        val districtId: String,
        val center: LatLng?,
        val feature: JSONObject,
    )

    /**
     * Fetch every obwód's open hunts and paint them into [baseStyleJson] (the
     * phone's style, untouched). Off the main thread; [onResult] comes back on
     * it, with null when there is nothing to go on at all (no access and no
     * offline copy, or no rewir outlines to place anything on).
     */
    fun refresh(context: Context, baseStyleJson: String, onResult: (Applied?) -> Unit) {
        val access = CarApi.access(context)
        CarApi.background {
            val applied = try {
                compute(context, access, baseStyleJson)
            } catch (e: Throwable) {
                Log.w(TAG, "occupancy failed", e)
                null
            }
            CarApi.main { onResult(applied) }
        }
    }

    /** The last good answer, without the network — for the first frame. */
    fun fromCache(context: Context, baseStyleJson: String, onResult: (Applied?) -> Unit) {
        CarApi.background {
            val applied = try {
                compute(context, null, baseStyleJson)
            } catch (e: Throwable) {
                Log.w(TAG, "cached occupancy failed", e)
                null
            }
            CarApi.main { onResult(applied) }
        }
    }

    // ---- fetch -----------------------------------------------------------

    private fun compute(context: Context, access: CarApi.Access?, baseStyleJson: String): Applied? {
        val style = JSONObject(baseStyleJson)
        val outlines = outlines(style)
        if (outlines.isEmpty()) {
            Log.i(TAG, "no rewir outlines in the published style; nothing to place occupancy on")
            return null
        }
        val cache = readCache(context)
        // Without access (no hand-over yet), the cache is all there is; it
        // still names the obwody and their labels.
        val districts: List<Pair<String, String>> = access?.districts
            ?: cache?.optJSONObject("labels")?.let { l -> l.keys().asSequence().map { it to l.optString(it) }.toList() }
            ?: return null
        val cachedDistricts = cache?.takeIf {
            access == null || (it.optString("unitId") == access.unitId && it.optInt("year") == access.year)
        }?.optJSONObject("districts")

        val rows = mutableListOf<Pair<String, JSONObject>>()
        var oldest = Long.MAX_VALUE
        var offline = false
        var any = false
        val fresh = JSONObject()
        for ((districtId, _) in districts) {
            var open: JSONArray? = null
            var at = 0L
            if (access != null) {
                try {
                    open = fetchOpen(context, access, districtId)
                    at = System.currentTimeMillis()
                } catch (e: Exception) {
                    Log.w(TAG, "obwód $districtId: ${e.message}")
                }
            }
            if (open == null) {
                val cached = cachedDistricts?.optJSONObject(districtId)
                open = cached?.optJSONArray("open")
                at = cached?.optLong("fetchedAt") ?: 0L
                if (open != null) offline = true
            }
            if (open == null) {
                // Neither network nor copy for this obwód: its rewiry cannot be
                // called free, so the whole picture counts as offline.
                offline = true
                continue
            }
            any = true
            oldest = minOf(oldest, at)
            fresh.put(districtId, JSONObject().put("fetchedAt", at).put("open", open))
            for (i in 0 until open.length()) open.optJSONObject(i)?.let { rows.add(districtId to it) }
        }
        if (!any) return null
        if (access != null) {
            writeCache(
                context,
                JSONObject()
                    .put("unitId", access.unitId)
                    .put("year", access.year)
                    .put("labels", JSONObject().apply { districts.forEach { (id, l) -> put(id, l) } })
                    .put("districts", fresh),
            )
        }
        val rewirs = toRewirs(rows, districts)
        return paint(style, outlines, rewirs, oldest, offline)
    }

    /** Unfinished hunts in one obwód's book — `fetchOpenHunts` on the phone. */
    private fun fetchOpen(context: Context, access: CarApi.Access, districtId: String): JSONArray {
        val open = JSONArray()
        val cutoff = System.currentTimeMillis() - LOOKBACK_MS
        var loaded = 0
        for (page in 1..MAX_PAGES) {
            val root = CarApi.bookPageBlocking(context, access, districtId, page)
            val arr = root.optJSONArray("result") ?: JSONArray()
            val total = root.optInt("total", arr.length())
            loaded += arr.length()
            var found = 0
            var recent = false
            for (i in 0 until arr.length()) {
                val e = arr.optJSONObject(i) ?: continue
                if (isOpenHunt(e)) {
                    open.put(e)
                    found++
                }
                if (touchedAt(e) >= cutoff) recent = true
            }
            if (arr.length() == 0 || loaded >= total) break
            // A full page with nothing open — everything below was written out.
            if (found == 0) break
            if (!recent) break
        }
        return open
    }

    // ---- the phone's rules -------------------------------------------------

    private fun str(e: JSONObject, name: String): String? =
        if (e.isNull(name)) null else e.optString(name).takeIf { it.isNotBlank() }

    /** `status === false` ⟺ crossed out. */
    private fun crossedOut(e: JSONObject) =
        e.has("status") && !e.isNull("status") && e.opt("status") == false

    private fun isOpenHunt(e: JSONObject): Boolean {
        if (crossedOut(e)) return false
        if (str(e, "checkoutPersonFullname") != null) return false
        if (e.opt("isEnded") == true) return false
        return true
    }

    private fun overdue(e: JSONObject): Boolean {
        if (crossedOut(e) || str(e, "checkoutPersonFullname") != null) return false
        val end = CarTime.parse(str(e, "endDate"))
        return end > 0 && end < System.currentTimeMillis()
    }

    private fun upcoming(e: JSONObject): Boolean {
        if (e.opt("isStarted") == true) return false
        val start = CarTime.parse(str(e, "startDate"))
        return start > 0 && start > System.currentTimeMillis()
    }

    private fun touchedAt(e: JSONObject): Long =
        maxOf(CarTime.parse(str(e, "startDate")), CarTime.parse(str(e, "endDate")))

    /** `rewirNames`: "Rewir: 2 A, 3b (Ambona A-4)" → ["2 A", "3b"]. */
    private fun rewirNames(place: String?): List<String> {
        if (place.isNullOrBlank()) return emptyList()
        val parts = place.split(':')
        val afterColon = parts.drop(1).joinToString(":")
        val body = afterColon.ifEmpty { place }.split('(')[0]
        return body.split(Regex("[,;]")).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    }

    private fun toRewirs(rows: List<Pair<String, JSONObject>>, districts: List<Pair<String, String>>): List<Rewir> {
        val byKey = LinkedHashMap<String, Rewir>()
        for ((districtId, e) in rows) {
            val names = rewirNames(str(e, "huntingPlace"))
            if (names.isEmpty()) continue
            val label = districts.firstOrNull { it.first == districtId }?.second ?: districtId
            val keys = listOfNotNull(districtId, str(e, "huntingDistrictId")).distinct()
            val hunter = Hunter(
                name = str(e, "leadingPersonFullname") ?: "Myśliwy",
                start = str(e, "startDate"),
                overdue = overdue(e),
                upcoming = upcoming(e),
            )
            for (name in names) {
                val key = CarMapStore.normalizeRewir(name)
                val rec = byKey["$districtId|$key"]
                if (rec != null) {
                    rec.hunters.add(hunter)
                    for (k in keys) if (k !in rec.districtKeys) rec.districtKeys.add(k)
                } else {
                    byKey["$districtId|$key"] = Rewir(
                        name, key, districtId, label, keys.toMutableList(), mutableListOf(hunter),
                    )
                }
            }
        }
        return byKey.values.sortedWith(
            Comparator<Rewir> { a, b -> natural(a.districtLabel, b.districtLabel) }
                .thenComparator { a, b -> natural(a.name, b.name) },
        )
    }

    private val collator = java.text.Collator.getInstance(java.util.Locale("pl"))

    /** `localeCompare(…, 'pl', { numeric: true })`: "2" before "10". */
    private fun natural(a: String, b: String): Int {
        val chunk = Regex("\\d+|\\D+")
        val x = chunk.findAll(a).map { it.value }.toList()
        val y = chunk.findAll(b).map { it.value }.toList()
        for (i in 0 until minOf(x.size, y.size)) {
            val p = x[i]
            val q = y[i]
            val c = if (p[0].isDigit() && q[0].isDigit()) {
                p.toBigInteger().compareTo(q.toBigInteger())
            } else {
                collator.compare(p, q)
            }
            if (c != 0) return c
        }
        return x.size - y.size
    }

    /** `fmtHunter` in carBridge.ts. */
    private fun fmtHunter(h: Hunter): String {
        val ms = CarTime.parse(h.start)
        val time = if (ms > 0) {
            val t = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault())
            String.format(java.util.Locale("pl"), "%02d:%02d", t.hour, t.minute)
        } else {
            "—"
        }
        return "${h.name} · ${if (h.upcoming) "zapisany od" else "od"} $time" +
            if (h.overdue) " · po czasie" else ""
    }

    // ---- painting --------------------------------------------------------

    private fun outlines(style: JSONObject): List<Outline> {
        val sources = style.optJSONObject("sources") ?: return emptyList()
        val out = LinkedHashMap<String, Outline>()
        for (src in listOf("geo-rewirs", OCCUPIED_SOURCE)) {
            val features = sources.optJSONObject(src)?.optJSONObject("data")
                ?.optJSONArray("features") ?: continue
            for (i in 0 until features.length()) {
                val f = features.optJSONObject(i) ?: continue
                val p = f.optJSONObject("properties") ?: continue
                val name = p.optString("name")
                val key = CarMapStore.normalizeRewir(name)
                if (key.isEmpty() || f.optJSONObject("geometry") == null) continue
                val district = p.optString("districtId").takeIf { it != "null" } ?: ""
                val center = if (p.has("centerLng") && p.has("centerLat") &&
                    !p.isNull("centerLng") && !p.isNull("centerLat")
                ) {
                    LatLng(p.optDouble("centerLat"), p.optDouble("centerLng"))
                } else {
                    centroid(f.optJSONObject("geometry"))
                }
                out.putIfAbsent("$district|$key", Outline(name, key, district, center, f))
            }
        }
        return out.values.toList()
    }

    /** Mean of the outer ring — the phone's `centroidOf` fallback. */
    private fun centroid(geometry: JSONObject?): LatLng? {
        val coords = geometry?.optJSONArray("coordinates") ?: return null
        val ring = when (geometry.optString("type")) {
            "Polygon" -> coords.optJSONArray(0)
            "MultiPolygon" -> coords.optJSONArray(0)?.optJSONArray(0)
            else -> null
        } ?: return null
        var lng = 0.0
        var lat = 0.0
        var n = 0
        for (i in 0 until ring.length()) {
            val p = ring.optJSONArray(i) ?: continue
            lng += p.optDouble(0)
            lat += p.optDouble(1)
            n++
        }
        return if (n == 0) null else LatLng(lat / n, lng / n)
    }

    private fun paint(
        style: JSONObject,
        outlines: List<Outline>,
        rewirs: List<Rewir>,
        fetchedAt: Long,
        offline: Boolean,
    ): Applied {
        // Polygons: agree on the obwód; if nothing does although hunts ARE
        // running, the two endpoints number obwody differently — fall back to
        // the label alone rather than paint nothing (the phone does the same).
        val byName = rewirs.groupBy { it.key }
        fun occupied(o: Outline, loose: Boolean): Boolean {
            val list = byName[o.key] ?: return false
            if (loose || o.districtId.isEmpty()) return true
            return list.any { it.districtKeys.isEmpty() || o.districtId in it.districtKeys }
        }
        val strict = outlines.filter { occupied(it, false) }
        val polygons = strict.ifEmpty { outlines.filter { occupied(it, true) } }

        // Pins: the rewir's centre, by obwód first, the label alone second.
        val centers = HashMap<String, LatLng>()
        for (o in outlines) {
            val c = o.center ?: continue
            centers.putIfAbsent("${o.districtId}|${o.key}", c)
            centers.putIfAbsent(o.key, c)
        }
        val color = Color.parseColor(OCCUPIED_COLOR)
        val markers = rewirs.mapNotNull { r ->
            val at = r.districtKeys.firstNotNullOfOrNull { centers["$it|${r.key}"] }
                ?: centers[r.key]
                ?: return@mapNotNull null
            CarMarker(
                id = "${r.districtId}|${r.key}",
                title = "Rewir ${r.name}",
                subtitle = (listOf("Obwód ${r.districtLabel}") + r.hunters.map(::fmtHunter))
                    .joinToString("\n"),
                position = at,
                color = color,
                keys = (listOf(r.districtId) + r.districtKeys).distinct().map { "$it|${r.key}" },
            )
        }

        val polygonFc = JSONObject().put("type", "FeatureCollection")
            .put("features", JSONArray().apply { polygons.forEach { put(it.feature) } })
        val pointFc = JSONObject().put("type", "FeatureCollection").put(
            "features",
            JSONArray().apply {
                for (m in markers) {
                    put(
                        JSONObject()
                            .put("type", "Feature")
                            .put(
                                "geometry",
                                JSONObject().put("type", "Point").put(
                                    "coordinates",
                                    JSONArray().put(m.position.longitude).put(m.position.latitude),
                                ),
                            )
                            .put(
                                "properties",
                                JSONObject().put("color", OCCUPIED_COLOR)
                                    .put("name", m.title.removePrefix("Rewir ")),
                            ),
                    )
                }
            },
        )
        writeLayers(style, polygonFc, pointFc)
        val shapes = CarMapStore.shapesFor(polygonFc.getJSONArray("features"), markers)
        return Applied(style.toString(), markers, shapes, fetchedAt, offline)
    }

    /**
     * Put the occupancy into the style, the way `buildMapStyle` would have:
     * replace the data of the phone's occupied sources, or add the sources and
     * their layers when the phone published none (nobody was hunting then).
     */
    private fun writeLayers(style: JSONObject, polygons: JSONObject, points: JSONObject) {
        val sources = style.optJSONObject("sources") ?: JSONObject().also { style.put("sources", it) }
        val layers = style.optJSONArray("layers") ?: JSONArray().also { style.put("layers", it) }
        sources.put(OCCUPIED_SOURCE, JSONObject().put("type", "geojson").put("data", polygons))
        sources.put(MARKER_SOURCE, JSONObject().put("type", "geojson").put("data", points))

        val ids = (0 until layers.length()).mapNotNull { layers.optJSONObject(it)?.optString("id") }
        if ("$OCCUPIED_SOURCE-fill" !in ids) {
            val add = mutableListOf(
                JSONObject().put("id", "$OCCUPIED_SOURCE-fill").put("type", "fill")
                    .put("source", OCCUPIED_SOURCE)
                    .put("paint", JSONObject().put("fill-color", OCCUPIED_COLOR).put("fill-opacity", 0.45)),
                JSONObject().put("id", "$OCCUPIED_SOURCE-line").put("type", "line")
                    .put("source", OCCUPIED_SOURCE)
                    .put("paint", JSONObject().put("line-color", OCCUPIED_COLOR).put("line-width", 3)),
            )
            // Only label when the plain rewir layer (which labels every
            // polygon) is off, so no number is drawn twice.
            if (!sources.has("geo-rewirs")) {
                add.add(
                    JSONObject().put("id", "$OCCUPIED_SOURCE-label").put("type", "symbol")
                        .put("source", OCCUPIED_SOURCE)
                        .put(
                            "layout",
                            JSONObject()
                                .put("text-field", JSONArray("[\"coalesce\",[\"get\",\"name\"],\"\"]"))
                                .put("text-font", JSONArray().put("Noto Sans Regular"))
                                .put("text-size", 12)
                                .put("symbol-placement", "point"),
                        )
                        .put(
                            "paint",
                            JSONObject().put("text-color", OCCUPIED_COLOR)
                                .put("text-halo-color", "#ffffff").put("text-halo-width", 1.4),
                        ),
                )
            }
            // Above the plain rewiry, below devices and pins — where
            // buildMapStyle puts them.
            val lastRewir = ids.indexOfLast { it.startsWith("geo-rewirs-") }
            val firstAfter = ids.indexOfFirst { it.startsWith("geo-devices") || it.startsWith(MARKER_SOURCE) }
            val at = when {
                lastRewir >= 0 -> lastRewir + 1
                firstAfter >= 0 -> firstAfter
                else -> ids.size
            }
            insert(layers, at, add)
        }
        if ("$MARKER_SOURCE-circle" !in ids) {
            layers.put(
                JSONObject().put("id", "$MARKER_SOURCE-circle").put("type", "circle")
                    .put("source", MARKER_SOURCE)
                    .put(
                        "paint",
                        JSONObject()
                            .put("circle-radius", 10)
                            .put("circle-color", JSONArray("[\"coalesce\",[\"get\",\"color\"],\"$OCCUPIED_COLOR\"]"))
                            .put("circle-stroke-color", "#ffffff")
                            .put("circle-stroke-width", 2),
                    ),
            )
        }
    }

    private fun insert(layers: JSONArray, index: Int, add: List<JSONObject>) {
        val all = (0 until layers.length()).map { layers.get(it) }.toMutableList()
        all.addAll(index.coerceIn(0, all.size), add)
        while (layers.length() > 0) layers.remove(layers.length() - 1)
        all.forEach { layers.put(it) }
    }

    // ---- offline copy ----------------------------------------------------

    private fun readCache(context: Context): JSONObject? = try {
        File(context.filesDir, CACHE_FILE).takeIf { it.exists() }?.readText()?.let(::JSONObject)
    } catch (e: Exception) {
        Log.w(TAG, "unreadable occupancy cache", e)
        null
    }

    private fun writeCache(context: Context, root: JSONObject) {
        try {
            File(context.filesDir, CACHE_FILE).writeText(root.toString())
        } catch (e: Exception) {
            Log.w(TAG, "could not cache occupancy", e)
        }
    }
}
