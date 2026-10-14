pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MobileOpsAgent"

include(":core")

// JVM contract/state tests remain available before the Android SDK is installed.
if (providers.gradleProperty("coreOnly").orNull != "true") include(":app")
