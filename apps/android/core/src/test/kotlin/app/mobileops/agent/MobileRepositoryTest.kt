package app.mobileops.agent

import app.mobileops.agent.data.DefaultMobileRepository
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import org.junit.Test

class MobileRepositoryTest {
    @Test
    fun constructingOrLeavingTheRepositoryDoesNotCreatePlatformSources() = runTest {
        var identityCalls = 0
        var pushCalls = 0
        val repository =
            DefaultMobileRepository(
                null,
                backgroundScope,
                createIdentity = {
                    identityCalls++
                    error("No sign-in requested")
                },
                createPushSource = {
                    pushCalls++
                    error("Notifications not enabled")
                },
            )
        assertNull(repository.connection.value.mode)
        repository.signOut()
        repository.resume()
        repository.close()
        assertEquals(0, identityCalls)
        assertEquals(0, pushCalls)
    }

    @Test
    fun switchingFixturesClearsOldAuthorityAndOfflineHidesEvidence() = runTest {
        val repository = DefaultMobileRepository(null, backgroundScope)
        repository.connectRehearsal("personal")
        val first = repository.workflow.value.inbox!!.items.first()
        repository.openWorkflow(first.id)
        assertNotNull(repository.workflow.value.detail)
        repository.reviewEvidence(true)
        repository.toggleRehearsalNetwork()
        assertTrue(repository.connection.value.disconnected)
        assertNull(repository.workflow.value.detail)
        assertFalse(repository.workflow.value.reviewed)
        repository.connectRehearsal("organization")
        assertEquals("organization", repository.workflow.value.scope!!.owner.kind)
        assertFalse(repository.connection.value.disconnected)
        assertNull(repository.workflow.value.selectedId)
        assertFalse(repository.workflow.value.reviewed)
        repository.signOut()
        assertNull(repository.workflow.value.scope)
        assertFalse(repository.agent.value.available)
    }
}
