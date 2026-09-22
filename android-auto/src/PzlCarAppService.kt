package com.smallgis.pzl.client.car

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/**
 * Entry point for Android Auto / Automotive. Declared in the manifest by the
 * `withAndroidAuto` config plugin; it has no effect on the phone app, which
 * never starts this service.
 */
class PzlCarAppService : CarAppService() {

    /**
     * This build is sideloaded onto the owner's own phone and paired with their
     * own head unit, so every host is accepted. A Play-distributed build would
     * pin this to the signed Google host allowlist instead.
     */
    override fun createHostValidator(): HostValidator =
        HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = PzlSession()
}
