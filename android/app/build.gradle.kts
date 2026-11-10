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
    testImplementation("junit:junit:4.13.2")
}
