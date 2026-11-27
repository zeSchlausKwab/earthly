package city.earthly.earthly_native

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.google.zxing.integration.android.IntentIntegrator
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : FlutterActivity() {
    companion object {
        private const val NIP55_CHANNEL = "city.earthly/nip55"
        private const val DEVICE_CHANNEL = "city.earthly/device"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEYSTORE_ALIAS = "earthly_settings_master_v1"
        private const val VAULT_PREFS_NAME = "earthly_keystore_vault"
        private const val VAULT_CIPHERTEXT_KEY = "master_key_ciphertext"
        private const val VAULT_IV_KEY = "master_key_iv"
        private const val MASTER_KEY_BYTES = 32
        private const val GCM_TAG_BITS = 128
        private const val REQUEST_GET_PUBKEY = 5501
        private const val REQUEST_SIGN_EVENT = 5502
        private const val REQUEST_NIP44_DECRYPT = 5503
        private const val REQUEST_NIP44_ENCRYPT = 5504
        private const val REQUEST_CAPTURE_PHOTO = 5601
        private const val REQUEST_PICK_IMAGE = 5602
        private const val REQUEST_PICK_PMTILES = 5603
        private const val REQUEST_PICK_GEOJSON = 5604
        private const val REQUEST_SAVE_GEOJSON = 5605
        private const val REQUEST_SAVE_BINARY = 5606
        private const val REQUEST_PICK_ANY_FILE = 5607
        private const val REQUEST_LOCATION_PERMISSION = 5701
        private const val REQUEST_TRACK_PERMISSION = 5702
        private const val MAX_PICKED_ATTACHMENT_BYTES = 25 * 1024 * 1024
        private const val CIRCLES_NOTIFICATION_CHANNEL_ID = "earthly_circles"
        private const val CIRCLES_NOTIFICATION_CHANNEL_NAME = "MLS Groups"
        private const val EXTRA_CIRCLE_PAYLOAD = "circle_payload"
        private val ANY_FILE_MIME_TYPES = arrayOf(
            "image/*",
            "audio/*",
            "video/*",
            "application/pdf",
            "text/*",
            "application/*",
        )
        private val nextNotificationId = AtomicInteger(8100)
    }

    private class FileTooLargeException(message: String) : Exception(message)

    private var pendingResult: MethodChannel.Result? = null
    private var pendingRequestCode: Int = 0
    private var pendingSaveContent: String? = null
    private var pendingSaveBytes: ByteArray? = null
    private var pendingPhotoFile: File? = null
    private var pendingLocationResult: MethodChannel.Result? = null
    private var pendingTrackStartResult: MethodChannel.Result? = null
    private var deviceChannel: MethodChannel? = null
    private var initialDeepLink: String? = null
    private var initialDroppedFile: Map<String, Any>? = null

    private fun normalizeCirclePayloadLink(rawPayload: String?): String? {
        val trimmed = rawPayload?.trim() ?: return null
        if (trimmed.isEmpty()) return null
        val lower = trimmed.lowercase()
        return if (lower.startsWith("earthly:") || lower.startsWith("nostr:") || lower.startsWith("geo:")) {
            trimmed
        } else {
            "earthly://circle/${Uri.encode(trimmed)}"
        }
    }

    private fun extractDeepLink(intent: Intent?): String? {
        val circlePayload = normalizeCirclePayloadLink(intent?.getStringExtra(EXTRA_CIRCLE_PAYLOAD))
        if (circlePayload != null) {
            return circlePayload
        }
        val uri = intent?.dataString ?: return null
        val lower = uri.lowercase()
        return if (lower.startsWith("earthly:") || lower.startsWith("nostr:") || lower.startsWith("geo:")) {
            uri
        } else {
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun extractSharedFile(intent: Intent?): Map<String, Any>? {
        if (intent == null) return null
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_SEND -> intent.getParcelableExtra(Intent.EXTRA_STREAM)
            Intent.ACTION_VIEW -> intent.data?.takeIf {
                it.scheme == "content" || it.scheme == "file"
            }
            else -> null
        }
        if (uri == null) return null
        return try {
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
            if (bytes == null || bytes.isEmpty()) return null
            val name = queryDisplayName(uri)
            val mime = contentResolver.getType(uri) ?: "application/octet-stream"
            mapOf(
                "bytes" to bytes,
                "mimeType" to mime,
                "name" to name,
            )
        } catch (_: Exception) {
            null
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val link = extractDeepLink(intent)
        intent.removeExtra(EXTRA_CIRCLE_PAYLOAD)
        if (link != null) {
            if (deviceChannel != null) {
                deviceChannel?.invokeMethod("onDeepLink", link)
            } else {
                initialDeepLink = link
            }
            return
        }
        val shared = extractSharedFile(intent) ?: return
        if (deviceChannel != null) {
            deviceChannel?.invokeMethod("onDroppedFile", shared)
        } else {
            initialDroppedFile = shared
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
                            putExtra(
                                "permissions",
                                "[{\"type\":\"sign_event\"},{\"type\":\"nip44_encrypt\"},{\"type\":\"nip44_decrypt\"}]",
                            )
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

                    "signEvent" -> handleSignEvent(call, result)

                    "nip44Decrypt" -> handleNip44Method(call, result, isEncrypt = false)

                    "nip44Encrypt" -> handleNip44Method(call, result, isEncrypt = true)

                    else -> result.notImplemented()
                }
            }

        ensureNotificationChannel(CIRCLES_NOTIFICATION_CHANNEL_ID)
        initialDeepLink = initialDeepLink ?: extractDeepLink(intent)
        intent?.removeExtra(EXTRA_CIRCLE_PAYLOAD)
        initialDroppedFile = initialDroppedFile ?: extractSharedFile(intent)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DEVICE_CHANNEL)
        deviceChannel = channel
        EarthlyTrackService.onPointListener = { sample ->
            runOnUiThread {
                deviceChannel?.invokeMethod("onGpsTrackPoint", sample.toMap())
            }
        }
        channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    "getInitialDeepLink" -> {
                        val link = initialDeepLink
                        initialDeepLink = null
                        result.success(link)
                    }

                    "getInitialDroppedFile" -> {
                        val dropped = initialDroppedFile
                        initialDroppedFile = null
                        result.success(dropped)
                    }

                    "getCurrentLocation" -> handleGetLocation(result)

                    "startGpsTrack" -> handleStartGpsTrack(result)

                    "pauseGpsTrack" -> {
                        val intent = Intent(this, EarthlyTrackService::class.java).apply {
                            action = EarthlyTrackService.ACTION_PAUSE
                        }
                        startService(intent)
                        result.success(true)
                    }

                    "resumeGpsTrack" -> {
                        val intent = Intent(this, EarthlyTrackService::class.java).apply {
                            action = EarthlyTrackService.ACTION_RESUME
                        }
                        startService(intent)
                        result.success(true)
                    }

                    "stopGpsTrack" -> {
                        val pts = EarthlyTrackService.samples.map { it.toMap() }
                        val intent = Intent(this, EarthlyTrackService::class.java).apply {
                            action = EarthlyTrackService.ACTION_STOP
                        }
                        startService(intent)
                        result.success(pts)
                    }

                    "getGpsTrackStatus" -> {
                        result.success(
                            mapOf(
                                "recording" to EarthlyTrackService.isRecording,
                                "paused" to EarthlyTrackService.isPaused,
                                "startedAtMs" to EarthlyTrackService.startedAtMs,
                                "points" to EarthlyTrackService.samples.map { it.toMap() },
                            ),
                        )
                    }

                    "capturePhoto" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val cameraDir = File(cacheDir, "camera").apply { mkdirs() }
                        val photoFile = File(cameraDir, "earthly-photo-${System.currentTimeMillis()}.jpg")
                        val photoUri = try {
                            FileProvider.getUriForFile(
                                this,
                                "${applicationContext.packageName}.fileprovider",
                                photoFile,
                            )
                        } catch (_: Exception) {
                            null
                        }
                        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                            if (photoUri != null) {
                                putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
                                addFlags(
                                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                                        Intent.FLAG_GRANT_READ_URI_PERMISSION,
                                )
                                clipData = ClipData.newRawUri("output", photoUri)
                            }
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_CAPTURE_PHOTO
                        pendingPhotoFile = if (photoUri != null) photoFile else null
                        try {
                            @Suppress("DEPRECATION")
                            startActivityForResult(intent, REQUEST_CAPTURE_PHOTO)
                        } catch (err: ActivityNotFoundException) {
                            pendingResult = null
                            pendingRequestCode = 0
                            pendingPhotoFile?.delete()
                            pendingPhotoFile = null
                            result.error(
                                "no_camera",
                                err.message ?: "No camera app available on this device",
                                null,
                            )
                        } catch (err: SecurityException) {
                            pendingResult = null
                            pendingRequestCode = 0
                            pendingPhotoFile?.delete()
                            pendingPhotoFile = null
                            result.error(
                                "camera_denied",
                                err.message ?: "Camera access was denied by the system",
                                null,
                            )
                        }
                    }

                    "pickImage" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*"))
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_PICK_IMAGE
                        try {
                            @Suppress("DEPRECATION")
                            startActivityForResult(intent, REQUEST_PICK_IMAGE)
                        } catch (err: ActivityNotFoundException) {
                            pendingResult = null
                            pendingRequestCode = 0
                            result.error("unavailable", err.message ?: "No document picker available", null)
                        }
                    }

                    "pickAnyFile" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                            putExtra(Intent.EXTRA_MIME_TYPES, ANY_FILE_MIME_TYPES)
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_PICK_ANY_FILE
                        try {
                            @Suppress("DEPRECATION")
                            startActivityForResult(intent, REQUEST_PICK_ANY_FILE)
                        } catch (err: ActivityNotFoundException) {
                            pendingResult = null
                            pendingRequestCode = 0
                            result.error("unavailable", err.message ?: "No document picker available", null)
                        }
                    }

                    "showLocalNotification" -> handleShowLocalNotification(call, result)

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
                        val mime = call.argument<String>("mimeType") ?: when {
                            filename.endsWith(".gpx", ignoreCase = true) -> "application/gpx+xml"
                            filename.endsWith(".kml", ignoreCase = true) -> "application/vnd.google-earth.kml+xml"
                            else -> "application/geo+json"
                        }
                        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = mime
                            putExtra(Intent.EXTRA_TITLE, filename)
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_SAVE_GEOJSON
                        pendingSaveContent = content
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_SAVE_GEOJSON)
                    }

                    "saveBinaryFile" -> {
                        if (pendingResult != null) {
                            result.error("busy", "Another picker/capture request is pending", null)
                            return@setMethodCallHandler
                        }
                        val filename = call.argument<String>("filename") ?: "earthly-poster.png"
                        val bytes = call.argument<ByteArray>("bytes") ?: ByteArray(0)
                        val mime = call.argument<String>("mimeType") ?: "application/octet-stream"
                        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = mime
                            putExtra(Intent.EXTRA_TITLE, filename)
                        }
                        pendingResult = result
                        pendingRequestCode = REQUEST_SAVE_BINARY
                        pendingSaveBytes = bytes
                        @Suppress("DEPRECATION")
                        startActivityForResult(intent, REQUEST_SAVE_BINARY)
                    }

                    "shareText" -> {
                        val text = call.argument<String>("text") ?: ""
                        val subject = call.argument<String>("subject")
                        if (text.isEmpty()) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, text)
                            if (!subject.isNullOrBlank()) {
                                putExtra(Intent.EXTRA_SUBJECT, subject)
                            }
                        }
                        val chooser = Intent.createChooser(shareIntent, subject ?: "Share from Earthly")
                        startActivity(chooser)
                        result.success(true)
                    }

                    "openExternalUri" -> {
                        val rawUri = (call.argument<String>("uri") ?: "").trim()
                        if (rawUri.isEmpty()) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        try {
                            val viewIntent = Intent(Intent.ACTION_VIEW, Uri.parse(rawUri)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(viewIntent)
                            result.success(true)
                        } catch (_: Exception) {
                            result.success(false)
                        }
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

                    "getOrCreateMasterKey" -> {
                        try {
                            result.success(getOrCreateMasterKeyBase64())
                        } catch (err: Exception) {
                            result.error(
                                "keystore_error",
                                err.message ?: "Failed to get or create master key",
                                null,
                            )
                        }
                    }

                    else -> result.notImplemented()
                }
            }
    }

    private fun resolveNip55Package(requested: String?): String? {
        if (!requested.isNullOrBlank()) return requested
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"))
        return packageManager.queryIntentActivities(probe, 0)
            .firstOrNull()
            ?.activityInfo
            ?.packageName
    }

    private fun handleSignEvent(
        call: MethodCall,
        result: MethodChannel.Result,
    ) {
        val eventJson = call.argument<String>("eventJson")
        if (eventJson.isNullOrBlank()) {
            result.error("invalid_args", "eventJson is required", null)
            return
        }
        val currentUser = call.argument<String>("currentUser")
        val signerPackage = resolveNip55Package(call.argument<String>("package"))
        if (signerPackage.isNullOrBlank()) {
            result.error("no_signer", "No NIP-55 signer app is available", null)
            return
        }

        // First try background NIP-55 ContentProvider signing so approved MLS
        // and Nostr requests complete silently without popping up an Activity.
        val projection = if (!currentUser.isNullOrBlank()) {
            arrayOf(eventJson, "", currentUser)
        } else {
            arrayOf(eventJson, "")
        }
        try {
            contentResolver.query(
                Uri.parse("content://$signerPackage.SIGN_EVENT"),
                projection,
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val rejectedIdx = cursor.getColumnIndex("rejected")
                    if (rejectedIdx >= 0) {
                        val rejectedVal = cursor.getString(rejectedIdx)
                        if (!rejectedVal.isNullOrBlank() &&
                            !rejectedVal.equals("false", ignoreCase = true) &&
                            rejectedVal != "0"
                        ) {
                            result.error(
                                "rejected",
                                "Signer rejected NIP-55 SIGN_EVENT request",
                                null,
                            )
                            return
                        }
                    }
                    val eventIdx = cursor.getColumnIndex("event")
                    val sigIdx = cursor.getColumnIndex("signature")
                    val resIdx = cursor.getColumnIndex("result")
                    val signedEvent = if (eventIdx >= 0) cursor.getString(eventIdx) else null
                    val signature = (if (sigIdx >= 0) cursor.getString(sigIdx) else null)
                        ?: (if (resIdx >= 0) cursor.getString(resIdx) else null)
                    if (!signedEvent.isNullOrBlank() || !signature.isNullOrBlank()) {
                        result.success(
                            mapOf(
                                "event" to signedEvent,
                                "signature" to signature,
                            ),
                        )
                        return
                    }
                }
            }
        } catch (_: Exception) {
            // Fall back to interactive Intent when ContentProvider signing is unavailable.
        }

        if (pendingResult != null) {
            result.error("busy", "Another request is already pending", null)
            return
        }
        val intent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("nostrsigner:${Uri.encode(eventJson)}"),
        ).apply {
            putExtra("type", "sign_event")
            putExtra("returnType", "event")
            if (!currentUser.isNullOrBlank()) {
                putExtra("current_user", currentUser)
            }
            setPackage(signerPackage)
        }
        if (intent.resolveActivity(packageManager) == null) {
            result.error("no_signer", "No NIP-55 signer app is available", null)
            return
        }
        pendingResult = result
        pendingRequestCode = REQUEST_SIGN_EVENT
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_SIGN_EVENT)
    }

    private fun handleNip44Method(
        call: MethodCall,
        result: MethodChannel.Result,
        isEncrypt: Boolean,
    ) {
        val payload = if (isEncrypt) {
            call.argument<String>("plaintext") ?: call.argument<String>("payload")
        } else {
            call.argument<String>("ciphertext") ?: call.argument<String>("payload")
        }
        if (payload.isNullOrEmpty()) {
            result.error(
                "invalid_args",
                "${if (isEncrypt) "plaintext" else "ciphertext"} is required",
                null,
            )
            return
        }
        val pubkey = call.argument<String>("pubkey") ?: call.argument<String>("pubKey")
        if (pubkey.isNullOrBlank()) {
            result.error("invalid_args", "pubkey is required", null)
            return
        }
        val currentUser = call.argument<String>("currentUser")
        val signerPackage = resolveNip55Package(call.argument<String>("package"))
        if (signerPackage.isNullOrBlank()) {
            result.error("no_signer", "No NIP-55 signer app (such as Amber) is installed", null)
            return
        }

        val authoritySuffix = if (isEncrypt) "NIP44_ENCRYPT" else "NIP44_DECRYPT"
        val projection = if (!currentUser.isNullOrBlank()) {
            arrayOf(payload, pubkey, currentUser)
        } else {
            arrayOf(payload, pubkey)
        }
        try {
            contentResolver.query(
                Uri.parse("content://$signerPackage.$authoritySuffix"),
                projection,
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val rejectedIdx = cursor.getColumnIndex("rejected")
                    if (rejectedIdx >= 0) {
                        val rejectedVal = cursor.getString(rejectedIdx)
                        if (!rejectedVal.isNullOrBlank() &&
                            !rejectedVal.equals("false", ignoreCase = true) &&
                            rejectedVal != "0"
                        ) {
                            result.error(
                                "rejected",
                                "Signer rejected NIP-55 $authoritySuffix request",
                                null,
                            )
                            return
                        }
                    }
                    val resultIdx = cursor.getColumnIndex("result")
                    val sigIdx = cursor.getColumnIndex("signature")
                    val resultVal = if (resultIdx >= 0) cursor.getString(resultIdx) else null
                    val sigVal = if (sigIdx >= 0) cursor.getString(sigIdx) else null
                    val value = resultVal?.takeIf { it.isNotBlank() }
                        ?: sigVal?.takeIf { it.isNotBlank() }
                    if (value != null) {
                        result.success(value)
                        return
                    }
                }
            }
        } catch (_: Exception) {
            // Fall back to interactive Intent when ContentProvider query is unavailable.
        }

        if (pendingResult != null) {
            result.error("busy", "Another request is already pending", null)
            return
        }
        val intent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("nostrsigner:${Uri.encode(payload)}"),
        ).apply {
            putExtra("type", if (isEncrypt) "nip44_encrypt" else "nip44_decrypt")
            putExtra("pubKey", pubkey)
            if (!currentUser.isNullOrBlank()) {
                putExtra("current_user", currentUser)
            }
            setPackage(signerPackage)
        }
        if (intent.resolveActivity(packageManager) == null) {
            result.error("no_signer", "No NIP-55 signer app is available", null)
            return
        }
        val requestCode = if (isEncrypt) REQUEST_NIP44_ENCRYPT else REQUEST_NIP44_DECRYPT
        pendingResult = result
        pendingRequestCode = requestCode
        @Suppress("DEPRECATION")
        startActivityForResult(intent, requestCode)
    }

    private fun getOrCreateWrappingKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getKey(KEYSTORE_ALIAS, null) as? SecretKey
        if (existing != null) {
            return existing
        }
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER,
        )
        val spec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private fun getOrCreateMasterKeyBase64(): String {
        val wrappingKey = getOrCreateWrappingKey()
        val prefs = getSharedPreferences(VAULT_PREFS_NAME, Context.MODE_PRIVATE)
        val cipherB64 = prefs.getString(VAULT_CIPHERTEXT_KEY, null)
        val ivB64 = prefs.getString(VAULT_IV_KEY, null)
        if (!cipherB64.isNullOrBlank() && !ivB64.isNullOrBlank()) {
            val ciphertext = Base64.decode(cipherB64, Base64.NO_WRAP)
            val iv = Base64.decode(ivB64, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey, GCMParameterSpec(GCM_TAG_BITS, iv))
            val unwrapped = cipher.doFinal(ciphertext)
            require(unwrapped.size == MASTER_KEY_BYTES) {
                "Unwrapped master key has invalid length: ${unwrapped.size}"
            }
            return Base64.encodeToString(unwrapped, Base64.NO_WRAP)
        }

        val masterKey = ByteArray(MASTER_KEY_BYTES)
        SecureRandom().nextBytes(masterKey)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(masterKey)
        val persisted = prefs.edit()
            .putString(VAULT_CIPHERTEXT_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .putString(VAULT_IV_KEY, Base64.encodeToString(iv, Base64.NO_WRAP))
            .commit()
        check(persisted) { "Failed to persist wrapped master key" }
        return Base64.encodeToString(masterKey, Base64.NO_WRAP)
    }

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    private fun handleStartGpsTrack(result: MethodChannel.Result) {
        if (!hasLocationPermission()) {
            if (pendingTrackStartResult != null) {
                result.error("busy", "Location permission request already pending", null)
                return
            }
            pendingTrackStartResult = result
            val perms = mutableListOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            ActivityCompat.requestPermissions(this, perms.toTypedArray(), REQUEST_TRACK_PERMISSION)
            return
        }
        launchTrackForegroundService()
        result.success(true)
    }

    private fun launchTrackForegroundService() {
        val intent = Intent(this, EarthlyTrackService::class.java).apply {
            action = EarthlyTrackService.ACTION_START
        }
        ContextCompat.startForegroundService(this, intent)
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
        if (requestCode == REQUEST_TRACK_PERMISSION && pendingTrackStartResult != null) {
            val callback = pendingTrackStartResult!!
            pendingTrackStartResult = null
            if (hasLocationPermission()) {
                launchTrackForegroundService()
                callback.success(true)
            } else {
                callback.error("permission_denied", "Location permission required for GPS track", null)
            }
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    private fun ensureNotificationChannel(channelId: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val name = if (channelId == CIRCLES_NOTIFICATION_CHANNEL_ID) {
            CIRCLES_NOTIFICATION_CHANNEL_NAME
        } else {
            channelId
        }
        val channel = NotificationChannel(
            channelId,
            name,
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            if (channelId == CIRCLES_NOTIFICATION_CHANNEL_ID) {
                description = "Encrypted MLS group messages and invites"
            }
        }
        mgr.createNotificationChannel(channel)
    }

    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    private fun handleShowLocalNotification(
        call: MethodCall,
        result: MethodChannel.Result,
    ) {
        val title = (call.argument<String>("title") ?: "").trim()
        val body = (call.argument<String>("body") ?: "").trim()
        if (title.isEmpty() && body.isEmpty()) {
            result.success(false)
            return
        }
        val resolvedChannelId = (call.argument<String>("channelId") ?: "")
            .trim()
            .ifEmpty { CIRCLES_NOTIFICATION_CHANNEL_ID }
        val normalizedLink = normalizeCirclePayloadLink(call.argument<String>("payload"))

        try {
            ensureNotificationChannel(resolvedChannelId)
            if (!hasNotificationPermission()) {
                result.success(false)
                return
            }
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            if (mgr == null) {
                result.success(false)
                return
            }
            val notificationId = nextNotificationId.getAndIncrement()
            val launchIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (!normalizedLink.isNullOrEmpty()) {
                    putExtra(EXTRA_CIRCLE_PAYLOAD, normalizedLink)
                }
            }
            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getActivity(
                this,
                notificationId,
                launchIntent,
                piFlags,
            )
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, resolvedChannelId)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
            val smallIcon = applicationInfo.icon.takeIf { it != 0 }
                ?: android.R.drawable.ic_dialog_info
            builder
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(smallIcon)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
            if (body.isNotEmpty()) {
                builder.setStyle(Notification.BigTextStyle().bigText(body))
            }
            val notification = builder.build()
            mgr.notify(notificationId, notification)
            result.success(true)
        } catch (_: SecurityException) {
            result.success(false)
        } catch (_: Exception) {
            result.success(false)
        }
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

    private fun queryFileSize(uri: Uri): Long? {
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.SIZE)
                    if (idx >= 0 && !c.isNull(idx)) c.getLong(idx) else null
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readUriBytesCapped(uri: Uri, maxBytes: Int): ByteArray? {
        val reportedSize = queryFileSize(uri)
        if (reportedSize != null && reportedSize > maxBytes.toLong()) {
            throw FileTooLargeException(
                "Selected file exceeds the ${maxBytes / (1024 * 1024)} MB limit",
            )
        }
        val input = contentResolver.openInputStream(uri) ?: return null
        return input.use { stream ->
            val initialCapacity = if (reportedSize != null && reportedSize in 1L..maxBytes.toLong()) {
                reportedSize.toInt().coerceAtMost(256 * 1024)
            } else {
                16 * 1024
            }
            val out = ByteArrayOutputStream(initialCapacity)
            val buffer = ByteArray(64 * 1024)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                total += read
                if (total > maxBytes) {
                    throw FileTooLargeException(
                        "Selected file exceeds the ${maxBytes / (1024 * 1024)} MB limit",
                    )
                }
                out.write(buffer, 0, read)
            }
            out.toByteArray()
        }
    }

    private fun inferMimeTypeFromFilename(filename: String): String? {
        val dot = filename.lastIndexOf('.')
        if (dot < 0 || dot == filename.length - 1) return null
        val ext = filename.substring(dot + 1).lowercase()
        return when (ext) {
            "geojson" -> "application/geo+json"
            "gpx" -> "application/gpx+xml"
            "kml" -> "application/vnd.google-earth.kml+xml"
            "pmtiles" -> "application/vnd.pmtiles"
            "webp" -> "image/webp"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        }
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

            if (requestCode == REQUEST_CAPTURE_PHOTO) {
                val photoFile = pendingPhotoFile
                pendingPhotoFile = null
                if (resultCode != Activity.RESULT_OK) {
                    photoFile?.delete()
                    callback.error("cancelled", "Request was cancelled", null)
                    return
                }
                try {
                    val fileBytes = if (photoFile != null && photoFile.exists() && photoFile.length() > 0L) {
                        val raw = photoFile.readBytes()
                        photoFile.delete()
                        if (raw.size > 4 * 1024 * 1024) {
                            // Downsample huge multi-megapixel captures cleanly for Blossom/MLS upload
                            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                            BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
                            var sample = 1
                            val maxDim = maxOf(bounds.outWidth, bounds.outHeight)
                            while (maxDim / sample > 2048) {
                                sample *= 2
                            }
                            val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
                            val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size, decodeOpts)
                            if (decoded != null) {
                                val out = ByteArrayOutputStream()
                                decoded.compress(Bitmap.CompressFormat.JPEG, 86, out)
                                decoded.recycle()
                                out.toByteArray()
                            } else {
                                raw
                            }
                        } else {
                            raw
                        }
                    } else {
                        photoFile?.delete()
                        @Suppress("DEPRECATION")
                        val bitmap = data?.extras?.get("data") as? Bitmap
                        if (bitmap != null) {
                            val stream = ByteArrayOutputStream()
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)
                            stream.toByteArray()
                        } else {
                            null
                        }
                    }
                    if (fileBytes == null || fileBytes.isEmpty()) {
                        callback.error("empty_photo", "Camera returned no image data", null)
                    } else {
                        callback.success(
                            mapOf(
                                "bytes" to fileBytes,
                                "mimeType" to "image/jpeg",
                                "name" to "photo-${System.currentTimeMillis()}.jpg",
                            ),
                        )
                    }
                } catch (err: Exception) {
                    photoFile?.delete()
                    callback.error("photo_read_failed", err.message ?: "Failed to read captured photo", null)
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

                REQUEST_NIP44_DECRYPT, REQUEST_NIP44_ENCRYPT -> {
                    val value = data.getStringExtra("result") ?: data.getStringExtra("signature")
                    if (value.isNullOrEmpty()) {
                        callback.error("empty_result", "Signer returned an empty NIP-44 result", null)
                    } else {
                        callback.success(value)
                    }
                }

                REQUEST_PICK_IMAGE, REQUEST_PICK_ANY_FILE, REQUEST_PICK_PMTILES, REQUEST_PICK_GEOJSON -> {
                    val uri = data.data
                    if (uri == null) {
                        callback.error("empty_file", "No file URI returned", null)
                        return
                    }
                    try {
                        val bytes = if (requestCode == REQUEST_PICK_ANY_FILE || requestCode == REQUEST_PICK_IMAGE) {
                            readUriBytesCapped(uri, MAX_PICKED_ATTACHMENT_BYTES)
                        } else {
                            contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        }
                        if (bytes == null || bytes.isEmpty()) {
                            callback.error("empty_file", "Selected file was empty", null)
                        } else {
                            val displayName = queryDisplayName(uri)
                            val mime = contentResolver.getType(uri)
                                ?: if (requestCode == REQUEST_PICK_ANY_FILE || requestCode == REQUEST_PICK_IMAGE) {
                                    inferMimeTypeFromFilename(displayName)
                                } else {
                                    null
                                }
                                ?: when (requestCode) {
                                    REQUEST_PICK_PMTILES -> "application/vnd.pmtiles"
                                    REQUEST_PICK_GEOJSON -> "application/geo+json"
                                    REQUEST_PICK_IMAGE -> "image/jpeg"
                                    else -> "application/octet-stream"
                                }
                            callback.success(
                                mapOf(
                                    "bytes" to bytes,
                                    "mimeType" to mime,
                                    "name" to displayName,
                                ),
                            )
                        }
                    } catch (err: FileTooLargeException) {
                        callback.error(
                            "file_too_large",
                            err.message ?: "Selected file exceeds the 25 MB limit",
                            null,
                        )
                    } catch (_: OutOfMemoryError) {
                        callback.error(
                            "file_too_large",
                            "Selected file is too large to load into memory",
                            null,
                        )
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

                REQUEST_SAVE_BINARY -> {
                    val uri = data.data
                    val bytes = pendingSaveBytes ?: ByteArray(0)
                    pendingSaveBytes = null
                    if (uri == null) {
                        callback.error("empty_file", "No destination URI returned", null)
                        return
                    }
                    try {
                        contentResolver.openOutputStream(uri)?.use { stream ->
                            stream.write(bytes)
                            stream.flush()
                        }
                        callback.success(queryDisplayName(uri))
                    } catch (err: Exception) {
                        callback.error("write_failed", err.message ?: "Failed to save binary file", null)
                    }
                }
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }
}
