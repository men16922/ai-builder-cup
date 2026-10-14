package app.mobileops.agent.app

data class OnboardingUiState(val visible: Boolean, val page: Int = 0) {
    val lastPage: Boolean
        get() = page == PAGE_COUNT - 1

    companion object {
        const val PAGE_COUNT = 3
    }
}
