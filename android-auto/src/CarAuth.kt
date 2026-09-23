package com.smallgis.pzl.client.car

import android.util.Base64
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import org.json.JSONObject

/**
 * Signing in from the car, without the phone app.
 *
 * This server issues NO refresh token (a login returns access_token/id_token
 * only, and `offline_access` is refused) and its access token lasts about 25
 * minutes, so the sole way to stay usable on a drive is to repeat the same
 * headless login the phone performs: prime the authorization session, POST the
 * credentials to the plain Spring login form, re-issue the authorize on the now
 * authenticated session, and exchange the code. See src/auth/headlessLogin.ts —
 * this is that flow in Kotlin, and the two must stay in step.
 */
object CarAuth {

    private const val TAG = "CarAuth"

    data class Credentials(
        val authIssuer: String,
        val clientId: String,
        val redirectUri: String,
        val scope: String,
        val username: String,
        val password: String,
        val helpdesccode: String,
    )

    /** Cookies for one login attempt; the session lives in JSESSIONID. */
    private class Jar {
        private val cookies = LinkedHashMap<String, String>()

        fun store(conn: HttpURLConnection) {
            conn.headerFields["Set-Cookie"]?.forEach { header ->
                val pair = header.substringBefore(';')
                val i = pair.indexOf('=')
                if (i > 0) cookies[pair.take(i).trim()] = pair.substring(i + 1).trim()
            }
        }

        fun header(): String = cookies.entries.joinToString("; ") { "${it.key}=${it.value}" }
    }

    /** @return a fresh access token, or null when the login did not succeed. */
    fun login(creds: Credentials): String? {
        return try {
            val jar = Jar()
            val verifier = randomUrlSafe(32)
            val challenge = base64Url(
                MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()),
            )
            val authorize = "${creds.authIssuer}/oauth2/authorize?" + form(
                "response_type" to "code",
                "client_id" to creds.clientId,
                "redirect_uri" to creds.redirectUri,
                "scope" to creds.scope,
                "state" to randomUrlSafe(8),
                "code_challenge" to challenge,
                "code_challenge_method" to "S256",
                "response_mode" to "query",
            )

            // 1. prime the session
            follow(authorize, jar, creds.redirectUri)
            // 2. authenticate it
            post(
                "${creds.authIssuer}/login",
                form(
                    "username" to creds.username,
                    "password" to creds.password,
                    "helpdesccode" to creds.helpdesccode,
                ),
                jar,
                creds.redirectUri,
            )
            // 3. re-issue the authorize; the redirect chain ends at ?code=…
            val landed = follow(authorize, jar, creds.redirectUri)
            val code = Regex("[?&]code=([^&]+)").find(landed)?.groupValues?.get(1)
            if (code == null) {
                Log.w(TAG, "login did not produce a code (bad credentials?)")
                return null
            }

            // 4. exchange it
            val body = post(
                "${creds.authIssuer}/oauth2/token",
                form(
                    "grant_type" to "authorization_code",
                    "code" to java.net.URLDecoder.decode(code, "UTF-8"),
                    "redirect_uri" to creds.redirectUri,
                    "client_id" to creds.clientId,
                    "code_verifier" to verifier,
                ),
                jar,
                creds.redirectUri,
            ) ?: return null
            JSONObject(body).optString("access_token").takeIf { it.isNotBlank() }
                ?.also { Log.i(TAG, "car signed in on its own") }
        } catch (e: Exception) {
            Log.w(TAG, "car login failed", e)
            null
        }
    }

    /** Follows redirects by hand, carrying cookies, and stops at the redirect
     *  URI — which is where the authorization code appears. */
    private fun follow(start: String, jar: Jar, redirectUri: String, depth: Int = 0): String {
        if (depth > 10) return start
        val conn = open(start, jar)
        conn.instanceFollowRedirects = false
        conn.requestMethod = "GET"
        conn.connect()
        jar.store(conn)
        val code = conn.responseCode
        val location = conn.getHeaderField("Location")
        conn.inputStream?.close()
        conn.disconnect()
        if (code in 300..399 && location != null) {
            val next = URL(URL(start), location).toString()
            if (next.startsWith(redirectUri)) return next
            return follow(next, jar, redirectUri, depth + 1)
        }
        return start
    }

    private fun post(url: String, body: String, jar: Jar, redirectUri: String): String? {
        val conn = open(url, jar)
        conn.requestMethod = "POST"
        conn.instanceFollowRedirects = false
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        conn.outputStream.use { it.write(body.toByteArray()) }
        val code = conn.responseCode
        jar.store(conn)
        val text = try {
            if (code in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else null
        } catch (e: Exception) {
            null
        }
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        // The login form answers with a redirect; walk it so the session
        // settles exactly as the browser would leave it.
        if (code in 300..399 && location != null) {
            val next = URL(URL(url), location).toString()
            if (!next.startsWith(redirectUri)) follow(next, jar, redirectUri)
        }
        return text
    }

    private fun open(url: String, jar: Jar): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 15000
            val cookies = jar.header()
            if (cookies.isNotEmpty()) setRequestProperty("Cookie", cookies)
        }

    private fun form(vararg pairs: Pair<String, String>): String =
        pairs.joinToString("&") { (k, v) ->
            "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
        }

    private fun randomUrlSafe(bytes: Int): String {
        val buf = ByteArray(bytes)
        SecureRandom().nextBytes(buf)
        return base64Url(buf)
    }

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
