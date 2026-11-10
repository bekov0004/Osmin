plugins {
    id("com.android.application")
}

android {
    namespace = "dev.osmin.phone"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.osmin.phone"
        minSdk = 30          // Android 11: the first with wireless debugging
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key until there is a release key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Google's TLS provider: the platform's one cannot export the keying material that adb's pairing needs.
    implementation("org.conscrypt:conscrypt-android:2.5.2")

    testImplementation("junit:junit:4.13.2")
    // The same provider for the JVM, so the adb code can be tested on a computer.
    testImplementation("org.conscrypt:conscrypt-openjdk-uber:2.5.2")
}
