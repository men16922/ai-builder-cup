package app.mobileops.agent.app.mobility

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.MobilityPlace
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Google Places photo with its required author attribution. Only short-lived https
 * googleusercontent.com URIs (no key) are fetched; any failure shows a neutral tile, never a
 * substitute image.
 */
@Composable
internal fun PlacePhoto(place: MobilityPlace, modifier: Modifier = Modifier, index: Int? = null) {
    val photo = place.photo
    val uri = photo?.uri
    val image by
        produceState<ImageBitmap?>(null, uri) {
            // Reset on every URI so a recycled card never keeps another place's photo.
            value = uri?.let(PlacePhotos::cached)
            if (uri != null && value == null) value = PlacePhotos.load(uri)
        }
    val uriHandler = LocalUriHandler.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            Modifier.fillMaxWidth()
                .height(132.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
        ) {
            val shown = image
            if (shown != null)
                Image(
                    shown,
                    contentDescription = stringResource(R.string.place_photo_of, place.name),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            else
                Icon(
                    Icons.Filled.Place,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.Center).size(28.dp),
                )
            index?.let { PlaceBadge(it, Modifier.align(Alignment.TopStart).padding(10.dp)) }
        }
        val authors = photo?.attributions.orEmpty()
        if (authors.isNotEmpty()) {
            val link = authors.firstNotNullOfOrNull { author -> author.uri?.takeIf(::safeLink) }
            Text(
                stringResource(
                    R.string.place_photo_attribution,
                    authors.joinToString(", ") { it.name },
                ),
                style = MaterialTheme.typography.labelSmall,
                color =
                    if (link != null) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    if (link != null) Modifier.clickable { uriHandler.openUri(link) } else Modifier,
            )
        }
    }
}

/** Number badge shared by candidate cards and map markers so the two always agree. */
@Composable
internal fun PlaceBadge(number: Int, modifier: Modifier = Modifier) {
    Box(
        modifier.size(26.dp).background(MaterialTheme.colorScheme.primary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            number.toString(),
            color = MaterialTheme.colorScheme.onPrimary,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
        )
    }
}

private fun safeLink(uri: String) =
    runCatching { URI(uri).scheme == "https" }.getOrDefault(false) && uri.length <= 2048

internal object PlacePhotos {
    private const val MAX_BYTES = 2 * 1024 * 1024
    private const val MAX_EDGE = 1024
    private val memory = LruCache<String, ImageBitmap>(24)

    fun cached(uri: String): ImageBitmap? = memory.get(uri)

    /** Only https hosts under googleusercontent.com are allowed, before and after redirects. */
    fun allowed(uri: String): Boolean = runCatching {
        val parsed = URI(uri)
        val host = parsed.host?.lowercase() ?: return false
        parsed.scheme == "https" &&
            parsed.userInfo == null &&
            (parsed.port == -1 || parsed.port == 443) &&
            (host == "googleusercontent.com" || host.endsWith(".googleusercontent.com")) &&
            uri.length <= 2048
    }
        .getOrDefault(false)

    suspend fun load(uri: String): ImageBitmap? =
        withContext(Dispatchers.IO) {
            memory.get(uri)?.let {
                return@withContext it
            }
            val bytes = runCatching { download(uri) }.getOrNull() ?: return@withContext null
            val image = runCatching { decode(bytes) }.getOrNull() ?: return@withContext null
            memory.put(uri, image)
            image
        }

    private fun download(start: String): ByteArray? {
        var current = start
        repeat(3) {
            if (!allowed(current)) return null
            val connection = URL(current).openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                connection.setRequestProperty("Accept", "image/*")
                when (connection.responseCode) {
                    HttpURLConnection.HTTP_OK -> {
                        if (connection.contentLengthLong > MAX_BYTES) return null
                        connection.inputStream.use { input ->
                            val output = ByteArrayOutputStream()
                            val buffer = ByteArray(16 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                if (output.size() > MAX_BYTES) return null
                            }
                            return output.toByteArray()
                        }
                    }
                    HttpURLConnection.HTTP_MOVED_PERM,
                    HttpURLConnection.HTTP_MOVED_TEMP,
                    HttpURLConnection.HTTP_SEE_OTHER,
                    307,
                    308 -> {
                        val next = connection.getHeaderField("Location") ?: return null
                        current = URI(current).resolve(next).toString()
                    }
                    else -> return null
                }
            } finally {
                connection.disconnect()
            }
        }
        return null
    }

    private fun decode(bytes: ByteArray): ImageBitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_EDGE) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
    }
}
