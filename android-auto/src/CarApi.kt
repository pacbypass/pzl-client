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
    /** Keep in step with BOOK_PAGE_SIZE in src/features/huntingBook/book.ts. */
    private const val PAGE_SIZE = 100
    private val io = Executors.newSingleThreadExecutor()

    data class Access(
        val baseUrl: String,
        val token: String,
        val unitId: String,
        val year: Int,
        val districts: List<Pair<String, String>>, // id to label
        val credentials: CarAuth.Credentials? = null,
    )

    /**
     * A token the car renewed itself, kept for the rest of the process and in
     * the app's private files (NOT SharedPreferences, which this app includes
     * in cloud backup).
     */
    private var renewed: String? = null
    private var renewedLoaded = false
    private const val RENEWED_FILE = "car-token.txt"
    /** A token this close to expiry is treated as already gone. */
    private const val EXPIRY_MARGIN_MS = 30_000L
    private const val SESSION_GONE = "Sesja wygasła — zaloguj się w aplikacji na telefonie"

    /**
     * The parsed `api` block, and the file state it was parsed from. The book
     * view asks for this on every frame and the location readout on every fix;
     * re-reading and parsing a several-hundred-KB file each time made the book
     * stutter, so it is only parsed again when the file changes.
     */
    private var cached: Access? = null
    private var cachedStamp: Pair<Long, Long>? = null
    /** The phone's published token, before a renewed one is chosen over it. */
    private var phoneToken: String? = null
    private var phoneExpiresAt: Long = 0L

    fun access(context: Context): Access? {
        val f = CarMapStore.file(context)
        val stamp = f.lastModified() to f.length()
        synchronized(this) {
            if (stamp != cachedStamp) {
                cached = parseAccess(f)
                cachedStamp = stamp
            }
            val base = cached ?: return null
            return base.copy(token = pickToken(context))
        }
    }

    private fun parseAccess(f: java.io.File): Access? {
        val root = try {
            if (!f.exists()) return null
            JSONObject(f.readText()).optJSONObject("api") ?: return null
        } catch (e: Exception) {
            Log.w(TAG, "no api block", e)
            return null
        }
        val token = root.optString("token").takeIf { it.isNotBlank() && it != "null" }
            ?: return null
        phoneToken = token
        phoneExpiresAt = root.optLong("expiresAt", 0L).takeIf { it > 0 }
            ?: (jwtExpiry(token) ?: 0L)
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
            credentials = root.optJSONObject("auth")?.let { a ->
                CarAuth.Credentials(
                    authIssuer = a.optString("authIssuer"),
                    clientId = a.optString("clientId"),
                    redirectUri = a.optString("redirectUri"),
                    scope = a.optString("scope"),
                    username = a.optString("username"),
                    password = a.optString("password"),
                    helpdesccode = a.optString("helpdesccode"),
                ).takeIf { it.username.isNotBlank() && it.password.isNotBlank() }
            },
        )
    }

    /**
     * Which token to send: whichever of the phone's and the car's own renewed
     * one lives longer. The renewed one used to win outright, forever — so
     * once the car had signed in, a fresh token from the phone was ignored,
     * every expiry cost a full login, and a phone signed into ANOTHER account
     * was never followed. A renewed token for a different user than the
     * phone's is dropped. Caller holds the lock.
     */
    private fun pickToken(context: Context): String {
        val phone = phoneToken ?: ""
        if (!renewedLoaded) {
            renewed = readRenewed(context)
            renewedLoaded = true
        }
        val mine = renewed
        if (mine == null || mine == phone) return phone
        val mineSub = subjectOf(mine)
        val phoneSub = subjectOf(phone)
        if (mineSub != null && phoneSub != null && mineSub != phoneSub) {
            Log.i(TAG, "phone is signed in as someone else; dropping the car's own token")
            renewed = null
            deleteRenewed(context)
            return phone
        }
        val mineExp = jwtExpiry(mine) ?: 0L
        return if (mineExp > phoneExpiresAt) mine else phone
    }

    private fun alive(expiresAt: Long) =
        expiresAt == 0L || expiresAt - EXPIRY_MARGIN_MS > System.currentTimeMillis()

    /** `exp` of a JWT access token, in ms, or null when it is not a JWT. */
    private fun jwtExpiry(token: String): Long? =
        claims(token)?.optLong("exp", 0L)?.takeIf { it > 0 }?.let { it * 1000 }

    private fun subjectOf(token: String): String? =
        claims(token)?.optString("sub")?.takeIf { it.isNotBlank() }

    private fun claims(token: String): JSONObject? = try {
        token.split('.').getOrNull(1)?.let {
            val flags = android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or
                android.util.Base64.NO_WRAP
            JSONObject(String(android.util.Base64.decode(it, flags)))
        }
    } catch (e: Exception) {
        null
    }

    /**
     * GET with the session handled: on a 401, first the other token on hand
     * (the phone's, when the car's own was sent), and only then a fresh
     * sign-in. Never surfaces a bare "401" to the driver.
     */
    internal fun getAuthed(context: Context, access: Access, url: String): String {
        try {
            return get(url, access.token)
        } catch (e: Unauthorized) {
            val phone = synchronized(this) { phoneToken?.takeIf { alive(phoneExpiresAt) } }
            if (phone != null && phone != access.token) {
                try {
                    val body = get(url, phone)
                    // The phone's token works and ours does not: stop using ours.
                    synchronized(this) {
                        if (renewed == access.token) {
                            renewed = null
                            deleteRenewed(context)
                        }
                    }
                    return body
                } catch (again: Unauthorized) {
                    // fall through to a sign-in
                }
            }
            // The token has aged out (they last ~25 minutes). Sign in again
            // here rather than telling a driver to pick up their phone.
            val fresh = signIn(context, access) ?: throw IllegalStateException(SESSION_GONE)
            try {
                return get(url, fresh)
            } catch (again: Unauthorized) {
                throw IllegalStateException(SESSION_GONE)
            }
        }
    }

    /** Runs network work on the car's IO thread. */
    internal fun background(block: () -> Unit) = io.execute(block)

    /** Dev harness only: prove the car can sign in on its own, without waiting
     *  ~25 minutes for the published token to expire. */
    fun signInNow(context: Context, onResult: (String?) -> Unit) {
        val access = access(context)
        if (access == null) {
            onResult(null)
            return
        }
        io.execute {
            val token = signIn(context, access)
            main { onResult(token) }
        }
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

    /**
     * Book page for one obwód. Runs off the main thread; the callback comes
     * back on it, because it ends in a surface repaint.
     *
     * Every page that arrives is written to disk, and any failure — no signal
     * in the woods, an expired session that cannot be renewed offline — falls
     * back to that copy rather than emptying the screen. The phone behaves the
     * same way (its query cache is persisted and it never drops a session on a
     * network error); the car has no business being stricter.
     */
    fun book(
        context: Context,
        districtId: String,
        page: Int,
        /** entries, total, when they were fetched, whether from the cache */
        onResult: (List<Entry>, Int, Long, Boolean) -> Unit,
        onError: (String) -> Unit,
    ) {
        val access = access(context)
        if (access == null) {
            val cached = readCache(context, districtId, page)
            if (cached != null) {
                main { onResult(cached.first, cached.second, cached.third, true) }
            } else {
                onError("Brak danych z telefonu")
            }
            return
        }
        io.execute {
            try {
                val body = getAuthed(context, access, bookUrl(access, districtId, page))
                val root = JSONObject(body)
                val arr = root.optJSONArray("result") ?: JSONArray()
                val total = root.optInt("total", arr.length())
                val entries = (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let(::entry)
                }
                writeCache(context, districtId, page, body)
                main { onResult(entries, total, System.currentTimeMillis(), false) }
            } catch (e: Exception) {
                Log.w(TAG, "book failed: ${e.message}")
                val cached = readCache(context, districtId, page)
                if (cached != null) {
                    Log.i(TAG, "serving page $page of $districtId from cache")
                    main { onResult(cached.first, cached.second, cached.third, true) }
                } else {
                    main { onError(e.message ?: "Błąd połączenia") }
                }
            }
        }
    }

    private fun bookUrl(access: Access, districtId: String, page: Int) =
        "${access.baseUrl}/units/${access.unitId}/hunting-districts/" +
            "$districtId/huntings?year=${access.year}&page=$page&itemsPerPage=$PAGE_SIZE"

    /**
     * One raw book page, for callers already on the IO thread (occupancy). The
     * page is cached exactly as `book` caches it, since it is the same data.
     */
    internal fun bookPageBlocking(context: Context, access: Access, districtId: String, page: Int): JSONObject {
        val body = getAuthed(context, access, bookUrl(access, districtId, page))
        writeCache(context, districtId, page, body)
        return JSONObject(body)
    }

    internal const val BOOK_PAGE_SIZE = PAGE_SIZE

    // ---- offline copy ----------------------------------------------------

    private fun cacheFile(context: Context, districtId: String, page: Int) =
        java.io.File(context.filesDir, "car-book-$districtId-$page.json")

    private fun writeCache(context: Context, districtId: String, page: Int, body: String) {
        try {
            cacheFile(context, districtId, page).writeText(body)
        } catch (e: Exception) {
            Log.w(TAG, "could not cache book page", e)
        }
    }

    /** @return entries, total and when it was stored, or null when absent. */
    private fun readCache(
        context: Context,
        districtId: String,
        page: Int,
    ): Triple<List<Entry>, Int, Long>? = try {
        val f = cacheFile(context, districtId, page)
        if (!f.exists()) null else {
            val root = JSONObject(f.readText())
            val arr = root.optJSONArray("result") ?: JSONArray()
            Triple(
                (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(::entry) },
                root.optInt("total", arr.length()),
                f.lastModified(),
            )
        }
    } catch (e: Exception) {
        Log.w(TAG, "unreadable book cache", e)
        null
    }

    private class Unauthorized : Exception("Brak autoryzacji")

    /**
     * Sign in with the credentials the phone published. Serialised so a burst
     * of 401s cannot start several logins at once.
     */
    private fun signIn(context: Context, access: Access): String? {
        // Its own lock, NOT the one `access()` takes: a login is several
        // seconds of network, and the main thread asks for access every frame.
        synchronized(signInLock) {
            // Another request may have signed in while this one waited.
            val current = synchronized(this) { renewed }
            if (current != null && current != access.token && alive(jwtExpiry(current) ?: 0L)) {
                return current
            }
            val creds = access.credentials ?: return null
            val token = CarAuth.login(creds) ?: return null
            synchronized(this) {
                renewed = token
                renewedLoaded = true
            }
            writeRenewed(context, token)
            return token
        }
    }

    private val signInLock = Any()

    private fun deleteRenewed(context: Context) {
        try {
            java.io.File(context.filesDir, RENEWED_FILE).delete()
        } catch (e: Exception) {
            Log.w(TAG, "could not drop renewed token", e)
        }
    }

    private fun readRenewed(context: Context): String? = try {
        java.io.File(context.filesDir, RENEWED_FILE).takeIf { it.exists() }?.readText()
            ?.trim()?.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
        null
    }

    private fun writeRenewed(context: Context, token: String) {
        try {
            java.io.File(context.filesDir, RENEWED_FILE).writeText(token)
        } catch (e: Exception) {
            Log.w(TAG, "could not store renewed token", e)
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
            if (code == 401) throw Unauthorized()
            if (code !in 200..299) {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                throw IllegalStateException("HTTP $code ${err.take(120)}")
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
            end != null && CarTime.parse(end) in 1..<System.currentTimeMillis() -> Status.OVERDUE
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

    internal fun main(block: () -> Unit) =
        android.os.Handler(android.os.Looper.getMainLooper()).post(block)
}
