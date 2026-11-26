import java.io.File
import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}

fun signingPathOrAlias(propertyKey: String, envKey: String): String? =
    keystoreProperties.getProperty(propertyKey)?.trim()?.takeIf { it.isNotEmpty() }
        ?: System.getenv(envKey)?.trim()?.takeIf { it.isNotEmpty() }

fun signingSecret(propertyKey: String, envKey: String): String? =
    keystoreProperties.getProperty(propertyKey)?.takeIf { it.isNotEmpty() }
        ?: System.getenv(envKey)?.takeIf { it.isNotEmpty() }

val releaseStorePath = signingPathOrAlias("storeFile", "ANDROID_KEYSTORE_PATH")
val releaseStoreFile = releaseStorePath?.let { path ->
    val candidate = File(path)
    if (candidate.isAbsolute) candidate else rootProject.file(path)
}
val releaseStorePassword = signingSecret("storePassword", "ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingPathOrAlias("keyAlias", "ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingSecret("keyPassword", "ANDROID_KEY_PASSWORD")

val hasReleaseSigning =
    releaseStoreFile != null &&
        releaseStoreFile.isFile &&
        !releaseStorePassword.isNullOrEmpty() &&
        !releaseKeyAlias.isNullOrEmpty() &&
        !releaseKeyPassword.isNullOrEmpty()

android {
    namespace = "city.earthly.earthly_native"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = "28.2.13676358"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "city.earthly.earthly_native"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = maxOf(flutter.minSdkVersion, 26)
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    packaging {
        jniLibs {
            excludes += listOf(
                "**/armeabi-v7a/**",
                "**/x86_64/**",
                "**/x86/**",
            )
        }
    }

    signingConfigs {
        create("release") {
            if (hasReleaseSigning) {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Use the release keystore when valid signing credentials exist;
            // fall back cleanly to debug signing for local developer builds.
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
