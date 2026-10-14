package com.smallgis.pzl.client.car

import java.util.concurrent.CopyOnWriteArrayList

/**
 * The car's ONE list of hunts: each obwód's book pages, as last fetched, with
 * when they were fetched. The book tab and the map's occupancy both read and
 * fill it, so they always show the same data with the same age, and a refresh
 * in either panel updates the other — the map recomputes who is hunting from a
 * page the book just pulled, without downloading it again, and vice versa.
 * (The phone app does the same with its shared query cache.)
 */
object CarHuntStore {
    data class Page(val body: String, val fetchedAt: Long)

    /** A page this young is used as it is instead of being fetched again. */
    const val FRESH_MS = 30_000L

    private val pages = HashMap<String, Page>()
    private val listeners = CopyOnWriteArrayList<(String, Int) -> Unit>()

    private fun key(districtId: String, page: Int) = "$districtId|$page"

    /** Store a freshly fetched page; listeners hear about it on the main thread. */
    fun put(districtId: String, page: Int, body: String, fetchedAt: Long) {
        synchronized(pages) { pages[key(districtId, page)] = Page(body, fetchedAt) }
        CarApi.main { listeners.forEach { it(districtId, page) } }
    }

    fun get(districtId: String, page: Int): Page? =
        synchronized(pages) { pages[key(districtId, page)] }

    /** The page, if it was fetched within [FRESH_MS]. */
    fun fresh(districtId: String, page: Int): Page? =
        get(districtId, page)?.takeIf { System.currentTimeMillis() - it.fetchedAt < FRESH_MS }

    fun listen(listener: (districtId: String, page: Int) -> Unit) {
        listeners.add(listener)
    }

    fun unlisten(listener: (districtId: String, page: Int) -> Unit) {
        listeners.remove(listener)
    }
}
