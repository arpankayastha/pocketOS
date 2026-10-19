import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Supabase publishable (anon) key: public, the same one the web app ships. Read from the repo's
// .env (VITE_SUPABASE_ANON_KEY) or the GX_ANON_KEY environment variable.
val anonKey: String = System.getenv("GX_ANON_KEY") ?: run {
    val env = rootProject.file("../.env")
    if (!env.exists()) "" else env.readLines().firstOrNull { it.startsWith("VITE_SUPABASE_ANON_KEY=") }?.substringAfter("=")?.trim() ?: ""
}
// Release signing: keystore path + passwords from the environment (see android/README.md).
val ksFile = System.getenv("GX_KEYSTORE")?.let { file(it) }

android {
    namespace = "app.grandxgamer"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.grandxgamer"
        minSdk = 26
        targetSdk = 35
        versionCode = (property("gx.versionCode") as String).toInt()
        versionName = property("gx.versionName") as String
        val web = property("gx.webUrl") as String
        buildConfigField("String", "WEB_URL", "\"$web\"")
        buildConfigField("String", "SUPABASE_URL", "\"${property("gx.supabaseUrl")}\"")
        buildConfigField("String", "ANON_KEY", "\"$anonKey\"")
        manifestPlaceholders["webUrl"] = web
        manifestPlaceholders["webHost"] = web.removePrefix("https://")
    }

    signingConfigs {
        if (ksFile != null) create("release") {
            storeFile = ksFile
            storePassword = System.getenv("GX_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("GX_KEY_ALIAS") ?: "grandxgamer"
            keyPassword = System.getenv("GX_KEY_PASSWORD") ?: System.getenv("GX_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (ksFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { buildConfig = true }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // Maven Central rate-limits this build machine; Robolectric's Android jars come from Google's mirror.
            it.systemProperty("robolectric.dependency.repo.url", "https://maven-central.storage-download.googleapis.com/maven2/")
                        it.systemProperty("gx.shots", System.getenv("GX_SHOTS") ?: "")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
    implementation("androidx.work:work-runtime:2.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.work:work-testing:2.10.1")
}
