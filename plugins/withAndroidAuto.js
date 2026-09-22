/**
 * Expo config plugin: adds the Android Auto / Automotive car app to the
 * prebuilt Android project.
 *
 * Everything here is ADDITIVE — a library dependency, a few manifest entries
 * and the Kotlin sources under `android-auto/src`. The React Native app is not
 * touched: the car service is only ever started by the car host, and the dev
 * preview activity has no launcher entry.
 */
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CAR_APP_VERSION = '1.7.0';
const PACKAGE_SUFFIX = 'car';
const SERVICE = '.car.PzlCarAppService';
const PREVIEW_ACTIVITY = '.car.CarMapPreviewActivity';

/**
 * The MapLibre engine the car renderer draws with, read from the React Native
 * module's own gradle.properties so the two can never drift apart. It is
 * `compileOnly`: the RN module already ships the AAR at runtime, but declares
 * it `implementation`, which keeps its classes off our compile classpath.
 */
function maplibreCoordinates(projectRoot) {
  const props = path.join(
    projectRoot,
    'node_modules',
    '@maplibre',
    'maplibre-react-native',
    'android',
    'gradle.properties',
  );
  const read = (key, fallback) => {
    try {
      const m = fs
        .readFileSync(props, 'utf8')
        .match(new RegExp(`^${key}=(.*)$`, 'm'));
      return m ? m[1].trim() : fallback;
    } catch {
      return fallback;
    }
  };
  const version = read('org.maplibre.reactnative.nativeVersion', '11.12.1');
  const variant = read('org.maplibre.reactnative.nativeVariant', 'opengl');
  return `org.maplibre.gl:android-sdk-${variant}:${version}`;
}

/** `androidx.car.app`, resolved from the same google() repo the app already uses. */
function withCarGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('androidx.car.app:app')) return cfg;
    const maplibre = maplibreCoordinates(cfg.modRequest.projectRoot);
    const block = [
      '    // Android Auto (see plugins/withAndroidAuto.js)',
      `    implementation "androidx.car.app:app:${CAR_APP_VERSION}"`,
      `    compileOnly "${maplibre}"`,
    ].join('\n');
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /dependencies\s*\{/,
      (m) => `${m}\n${block}`,
    );
    return cfg;
  });
}

function ensurePermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] ?? [];
  if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function withCarManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    // Drawing our own map on the car screen needs the surface; the navigation
    // category needs the navigation templates.
    ensurePermission(manifest, 'androidx.car.app.ACCESS_SURFACE');
    ensurePermission(manifest, 'androidx.car.app.NAVIGATION_TEMPLATES');

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    app['meta-data'] = app['meta-data'] ?? [];
    if (
      !app['meta-data'].some(
        (m) => m.$['android:name'] === 'com.google.android.gms.car.application',
      )
    ) {
      app['meta-data'].push({
        $: {
          'android:name': 'com.google.android.gms.car.application',
          'android:resource': '@xml/automotive_app_desc',
        },
      });
    }
    if (
      !app['meta-data'].some(
        (m) => m.$['android:name'] === 'androidx.car.app.minCarApiLevel',
      )
    ) {
      app['meta-data'].push({
        $: {
          'android:name': 'androidx.car.app.minCarApiLevel',
          'android:value': '1',
        },
      });
    }

    app.service = app.service ?? [];
    if (!app.service.some((s) => s.$['android:name'] === SERVICE)) {
      app.service.push({
        $: { 'android:name': SERVICE, 'android:exported': 'true' },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
            category: [
              { $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } },
            ],
          },
        ],
      });
    }

    // Dev harness: reachable only by explicit component name (no intent filter,
    // so it never shows up in the launcher).
    app.activity = app.activity ?? [];
    if (!app.activity.some((a) => a.$['android:name'] === PREVIEW_ACTIVITY)) {
      app.activity.push({
        $: {
          'android:name': PREVIEW_ACTIVITY,
          'android:exported': 'true',
          'android:label': 'Car map preview',
        },
      });
    }

    return cfg;
  });
}

/** Copies the Kotlin sources and the car app descriptor into the prebuild. */
function withCarSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const pkg = AndroidConfig.Package.getPackage(cfg);
      if (!pkg) throw new Error('withAndroidAuto: android package missing');

      const srcDir = path.join(projectRoot, 'android-auto', 'src');
      const destDir = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        ...pkg.split('.'),
        PACKAGE_SUFFIX,
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.kt'))) {
        const contents = fs
          .readFileSync(path.join(srcDir, file), 'utf8')
          // The sources are written against the real package; keep them in step
          // if the application id ever changes.
          .replace(
            /^package .*$/m,
            `package ${pkg}.${PACKAGE_SUFFIX}`,
          );
        fs.writeFileSync(path.join(destDir, file), contents);
      }

      const xmlDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.copyFileSync(
        path.join(projectRoot, 'android-auto', 'res', 'automotive_app_desc.xml'),
        path.join(xmlDir, 'automotive_app_desc.xml'),
      );

      return cfg;
    },
  ]);
}

module.exports = function withAndroidAuto(config) {
  return withCarSources(withCarManifest(withCarGradle(config)));
};
