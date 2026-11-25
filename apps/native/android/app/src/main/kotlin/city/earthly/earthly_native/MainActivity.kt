package city.earthly.earthly_native

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.zxing.integration.android.IntentIntegrator
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream

class MainActivity : FlutterActivity() {
    companion object {
        private const val NIP55_CHANNEL = "city.earthly/nip55"
        private const val DEVICE_CHANNEL = "city.earthly/device"
        private const val REQUEST_GET_PUBKEY = 5501
        private const val REQUEST_SIGN_EVENT = 5502
        private const val REQUEST_CAPTURE_PHOTO = 5601
        private const val REQUEST_PICK_IMAGE = 5602
        private const val REQUEST_PICK_PMTILES = 5603
        private const val REQUEST_PICK_GEOJSON = 5604
        private const val REQUEST_SAVE_GEOJSON = 5605
        private const val REQUEST_LOCATION_PERMISSION = 5701
    }

    private var pendingResult: MethodChannel.Result? = null
    private var pendingRequestCode: Int = 0
    private var pendingSaveContent: String? = null
    private var pendingLocationResult: MethodChannel.Result? = null
    private var deviceChannel: MethodChannel? = null
    private var initialDeepLink: String? = null

    private fun extractDeepLink(intent: Intent?): String? {
        val uri = intent?.dataString ?: return null
        val lower = uri.lowercase()
        return if (lower.startsWith("earthly:") || lower.startsWith("nostr:") || lower.startsWith("geo:")) {
            uri
        } else {
            null
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val link = extractDeepLink(intent) ?: return
        if (deviceChannel != null) {
            deviceChannel?.invokeMethod("onDeepLink", link)
        } else {
            initialDeepLink = link
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, NIP55_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isSignerInstalled" -> {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
                        val resolved = packageManager.queryIntentActivities(intent, 0)
                        result.success(resolved.isNotEmpty())
                    }

                    "getPublicKey" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another request is already pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:")).apply {
                            putExtra("type", "get_public_key")
                        }
                        if (intent.resolveActivity(packageManager) == null) {
                            result.error("no_signer", "No NIP-55 signer app (such as Amber) is installed", null)
                            return@setMethodCallHandler
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_GET_PUBKEY
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_GET_PUBKEY)
                    }

                    "signEvent" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another request is already pending", null)
                            return@setMethodCallHandler
                        }
                        val eventJson = call.argument<String>("eventJson")
                        if (eventJson.isNullOrBlank()) {
                            result.error("invalid_args", "eventJson is required", null)
                            return@setMethodCallHandler
                        }
                        val currentUser = call.argument<String>("currentUser")
                        val signerPackage = call.argument<String>("package")
                        val intent = Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse("nostrsigner:$eventJson"),
                        ).apply {
                            putExtra("type", "sign_event")
                            putExtra("returnType", "event")
                            if (!currentUser.isNullOrBlank()) {
                                putExtra("current_user", currentUser)
                            }
                            if (!signerPackage.isNullOrBlank()) {
                                setPackage(signerPackage)
                            }
                        }
                        if (intent.resolveActivity(packageManager) == null) {
                            result.error("no_signer", "No NIP-55 signer app is available", null)
                            return@setMethodCallHandler
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_SIGN_EVENT
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_SIGN_EVENT)
                    }

                    else -> result.notImplemented()
                }
            }

        initialDeepLink = initialDeepLink ?: extractDeepLink(intent)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DEVICE_CHANNEL)
        deviceChannel = channel
        channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "getInitialDeepLink" -> {
                        val link = initialDeepLink
                        initialDeepLink = null
                        result.success(link)
                    }

                    "getCurrentLocation" -> handleGetLocation(result)

                    "capturePhoto" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                        if (intent.resolveActivity(packageManager) == null) {
                            result.error("no_camera", "No camera app available on this device", null)
                            return@setMethodCallHandler
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_CAPTURE_PHOTO
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_CAPTURE_PHOTO)
                    }

                    "pickImage" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                            type = "image/*"
                            addCategory(Intent.CATEGORY_OPENABLE)
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_PICK_IMAGE
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_PICK_IMAGE)
                    }

                    "pickPmtilesFile" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_PICK_PMTILES
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_PICK_PMTILES)
                    }

                    "pickGeoJsonFile" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_PICK_GEOJSON
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_PICK_GEOJSON)
                    }

                    "saveGeoJsonFile" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val filename = call.argument<String>("filename") ?: "earthly-map.geojson"
                        val content = call.argument<String>("content") ?: ""
                        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "application/geo+json"
                            putExtra(Intent.EXTRA_TITLE, filename)
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_SAVE_GEOJSON
                        pendingSaveContent = content
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_SAVE_GEOJSON)
                    }

                    "scanQrCode" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        pendingResult = result
                        pendingRequestCode = IntentIntegrator.REQUEST_CODE
                        @Suppress("DEPRECATION")
                        IntentIntegrator(this).apply {
                            setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                            setPrompt("Scan Earthly Field Session QR")
                            setBeepEnabled(false)
                            setOrientationLocked(false)
                            initiateScan()
                        }
                    }

                    else -> result.notImplemented()
                }
            }
    }

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    private fun handleGetLocation(result: MethodChannel.Result) {
        if (!hasLocationPermission()) {
            if (pendingLocationResult != null) {
                result.error("busy", "Location permission request already pending", null)
                return
            }
            pendingLocationResult = result
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                REQUEST_LOCATION_PERMISSION,
            )
            return
        }
        resolveBestLocation(result)
    }

    @SuppressLint("MissingPermission")
    private fun resolveBestLocation(result: MethodChannel.Result) {
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        if (lm == null) {
            result.error("unavailable", "LocationManager unavailable", null)
            return
        }
        val providers = lm.getProviders(true)
        var best: Location? = null
        for (provider in providers) {
            val loc = try {
                lm.getLastKnownLocation(provider)
            } catch (_: SecurityException) {
                null
            }
            if (loc != null && (best == null || loc.accuracy < best.accuracy)) {
                best = loc
            }
        }
        if (best != null) {
            result.success(
                mapOf(
                    "lat" to best.latitude,
                    "lon" to best.longitude,
                    "accuracy" to best.accuracy.toDouble(),
                ),
            )
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val provider = when {
                lm.isProviderEnabled(LocationManager.FUSED_PROVIDER) -> LocationManager.FUSED_PROVIDER
                lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
                else -> null
            }
            if (provider != null) {
                lm.getCurrentLocation(provider, null, mainExecutor) { loc ->
                    if (loc != null) {
                        result.success(
                            mapOf(
                                "lat" to loc.latitude,
                                "lon" to loc.longitude,
                                "accuracy" to loc.accuracy.toDouble(),
                            ),
                        )
                    } else {
                        result.error("no_fix", "Could not acquire GPS fix right now", null)
                    }
                }
                return
            }
        }
        result.error("no_fix", "No location fix available yet", null)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        if (requestCode == REQUEST_LOCATION_PERMISSION && pendingLocationResult != null) {
            val callback = pendingLocationResult!!
            pendingLocationResult = null
            if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
                resolveBestLocation(callback)
            } else {
                callback.error("permission_denied", "Location permission was denied", null)
            }
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    private fun queryDisplayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) return c.getString(idx) ?: "file"
            }
        }
        return uri.lastPathSegment ?: "file"
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == pendingRequestCode && pendingResult != null) {
            val callback = pendingResult!!
            pendingResult = null
            pendingRequestCode = 0

            if (requestCode == IntentIntegrator.REQUEST_CODE) {
                val parsed = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
                val contents = parsed?.contents
                if (contents.isNullOrBlank()) {
                    callback.error("cancelled", "QR scan was cancelled", null)
                } else {
                    callback.success(contents)
                }
                return
            }

            if (resultCode != Activity.RESULT_OK || data == null) {
                callback.error("cancelled", "Request was cancelled", null)
                return
            }

            when (requestCode) {
                REQUEST_GET_PUBKEY -> {
                    val pubkey = data.getStringExtra("result") ?: data.getStringExtra("signature")
                    val pkg = data.getStringExtra("package")
                    if (pubkey.isNullOrBlank()) {
                        callback.error("empty_result", "Signer returned no public key", null)
                    } else {
                        callback.success(
                            mapOf(
                                "pubkey" to pubkey,
                                "package" to pkg,
                            ),
                        )
                    }
                }

                REQUEST_SIGN_EVENT -> {
                    val signedEvent = data.getStringExtra("event")
                    val signature = data.getStringExtra("signature") ?: data.getStringExtra("result")
                    callback.success(
                        mapOf(
                            "event" to signedEvent,
                            "signature" to signature,
                        ),
                    )
                }

                REQUEST_CAPTURE_PHOTO -> {
                    @Suppress("DEPRECATION")
                    val bitmap = data.extras?.get("data") as? Bitmap
                    if (bitmap == null) {
                        callback.error("empty_photo", "Camera returned no image bitmap", null)
                    } else {
                        val stream = ByteArrayOutputStream()
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)
                        callback.success(
                            mapOf(
                                "bytes" to stream.toByteArray(),
                                "mimeType" to "image/jpeg",
                                "name" to "sighting-${System.currentTimeMillis()}.jpg",
                            ),
                        )
                    }
                }

                REQUEST_PICK_IMAGE, REQUEST_PICK_PMTILES, REQUEST_PICK_GEOJSON -> {
                    val uri = data.data
                    if (uri == null) {
                        callback.error("empty_file", "No file URI returned", null)
                        return
                    }
                    try {
                        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        if (bytes == null || bytes.isEmpty()) {
                            callback.error("empty_file", "Selected file was empty", null)
                        } else {
                            val mime = contentResolver.getType(uri)
                                ?: when (requestCode) {
                                    REQUEST_PICK_PMTILES -> "application/vnd.pmtiles"
                                    REQUEST_PICK_GEOJSON -> "application/geo+json"
                                    else -> "image/jpeg"
                                }
                            callback.success(
                                mapOf(
                                    "bytes" to bytes,
                                    "mimeType" to mime,
                                    "name" to queryDisplayName(uri),
                                ),
                            )
                        }
                    } catch (err: Exception) {
                        callback.error("read_failed", err.message ?: "Failed to read file", null)
                    }
                }

                REQUEST_SAVE_GEOJSON -> {
                    val uri = data.data
                    val content = pendingSaveContent ?: ""
                    pendingSaveContent = null
                    if (uri == null) {
                        callback.error("empty_file", "No destination URI returned", null)
                        return
                    }
                    try {
                        contentResolver.openOutputStream(uri)?.use { stream ->
                            stream.write(content.toByteArray(Charsets.UTF_8))
                            stream.flush()
                        }
                        callback.success(queryDisplayName(uri))
                    } catch (err: Exception) {
                        callback.error("write_failed", err.message ?: "Failed to save GeoJSON", null)
                    }
                }
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }
}
