package com.smallgis.pzl.client.car

import android.content.Context
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * The car app's own connection to the PZŁ API.
 *
 * The car cannot lean on the phone app being awake — Android Auto starts this
 * service on its own — so it reads the access token and the ids the phone
 * published and makes its own calls. The rules for what an entry MEANS
 * (crossed out, written out, overdue, still open) are the same ones in
 * `src/features/huntingBook/book.ts`; keep the two in step.
 */
object CarApi {

    private const val TAG = "CarApi"
    private val io = Executors.newSingleThreadExecutor()

    data class Access(
        val baseUrl: String,
        val token: String,
        val unitId: String,
        val year: Int,
        val districts: List<Pair<String, String>>, // id to label
    )

    fun access(context: Context): Access? {
        val root = try {
            val f = CarMapStore.file(context)
            if (!f.exists()) return null
            JSONObject(f.readText()).optJSONObject("api") ?: return null
        } catch (e: Exception) {
            Log.w(TAG, "no api block", e)
            return null
        }
        val token = root.optString("token").takeIf { it.isNotBlank() && it != "null" }
            ?: return null
        val unitId = root.optString("unitId").takeIf { it.isNotBlank() && it != "null" }
            ?: return null
        val year = root.optInt("year").takeIf { it > 0 } ?: return null
        val districts = mutableListOf<Pair<String, String>>()
        val arr = root.optJSONArray("districts") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val d = arr.optJSONObject(i) ?: continue
            val id = d.optString("id")
            if (id.isNotBlank()) districts.add(id to d.optString("label"))
        }
        return Access(
            baseUrl = root.optString("baseUrl").ifBlank { "https://api.systemkl2.pzlow.pl" },
            token = token,
            unitId = unitId,
            year = year,
            districts = districts,
        )
    }

    /** One entry of the książka ewidencji, as the phone's list shows it. */
    data class Entry(
        val id: String,
        val number: String,
        val hunter: String,
        val place: String,
        val start: String?,
        val end: String?,
        val status: Status,
        val harvest: List<String>,
        val shots: Int?,
    )

    enum class Status { CROSSED, CLOSED, OVERDUE, ACTIVE }

    /** Book page for one obwód. Runs off the main thread; the callback comes
     *  back on it, because it ends in a surface repaint. */
    fun book(
        context: Context,
        districtId: String,
        page: Int,
        onResult: (List<Entry>, Int) -> Unit,
        onError: (String) -> Unit,
    ) {
        val access = access(context)
        if (access == null) {
            onError("Brak danych logowania z telefonu")
            return
        }
        io.execute {
            try {
                val url = "${access.baseUrl}/units/${access.unitId}/hunting-districts/" +
                    "$districtId/huntings?year=${access.year}&page=$page"
                val body = get(url, access.token)
                val root = JSONObject(body)
                val arr = root.optJSONArray("result") ?: JSONArray()
                val total = root.optInt("total", arr.length())
                val entries = (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let(::entry)
                }
                main { onResult(entries, total) }
            } catch (e: Exception) {
                Log.w(TAG, "book failed", e)
                main { onError(e.message ?: "Błąd połączenia") }
            }
        }
    }

    private fun get(url: String, token: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Accept", "application/json")
        conn.connectTimeout = 10000
        conn.readTimeout = 15000
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                throw IllegalStateException(
                    if (code == 401) "Sesja wygasła — otwórz aplikację na telefonie"
                    else "HTTP $code ${err.take(120)}",
                )
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun entry(o: JSONObject): Entry {
        val checkout = o.optString("checkoutPersonFullname")
            .takeIf { it.isNotBlank() && it != "null" }
        val crossed = o.has("status") && !o.isNull("status") && o.optBoolean("status", true).not()
        val end = o.optString("endDate").takeIf { it.isNotBlank() && it != "null" }
        val status = when {
            crossed -> Status.CROSSED
            checkout != null || o.optBoolean("isEnded", false) -> Status.CLOSED
            end != null && parseTime(end) in 1..<System.currentTimeMillis() -> Status.OVERDUE
            else -> Status.ACTIVE
        }
        // The list endpoint returns `animals` as a comma-joined string.
        val harvest = o.optString("animals")
            .takeIf { it.isNotBlank() && it != "null" }
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: emptyList()
        return Entry(
            id = o.opt("id")?.toString() ?: "",
            number = o.opt("number")?.toString() ?: "—",
            hunter = o.optString("leadingPersonFullname").ifBlank { "Myśliwy" },
            place = o.optString("huntingPlace").takeIf { it.isNotBlank() && it != "null" } ?: "",
            start = o.optString("startDate").takeIf { it.isNotBlank() && it != "null" },
            end = end,
            status = status,
            harvest = harvest,
            shots = if (o.isNull("shotsFired")) null else o.optInt("shotsFired"),
        )
    }

    private fun parseTime(iso: String): Long = try {
        java.time.Instant.parse(
            if (iso.endsWith("Z") || iso.contains('+')) iso else iso + "Z",
        ).toEpochMilli()
    } catch (e: Exception) {
        0L
    }

    private fun main(block: () -> Unit) =
        android.os.Handler(android.os.Looper.getMainLooper()).post(block)
}
