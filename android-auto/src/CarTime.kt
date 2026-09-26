package com.smallgis.pzl.client.car

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * API timestamps, read the way the phone's `Date.parse` reads them, so the car
 * never disagrees with the phone about whether a hunt is over:
 *  - with a zone ("…Z", "…+02:00") → that instant;
 *  - a date and time with no zone  → LOCAL time (as JavaScript does);
 *  - a bare date                   → midnight UTC (as JavaScript does).
 * Unparseable → 0.
 */
object CarTime {
    fun parse(iso: String?): Long {
        if (iso.isNullOrBlank()) return 0L
        val s = iso.trim()
        return try {
            when {
                s.endsWith("Z") || s.endsWith("z") -> Instant.parse(s.uppercase()).toEpochMilli()
                OFFSET.containsMatchIn(s) -> OffsetDateTime.parse(s).toInstant().toEpochMilli()
                s.contains('T') ->
                    LocalDateTime.parse(s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
                else -> LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            }
        } catch (e: Exception) {
            0L
        }
    }

    /** "+02:00" after the time part. */
    private val OFFSET = Regex("T.*[+-]\\d{2}:\\d{2}$")
}
