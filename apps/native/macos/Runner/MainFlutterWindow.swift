import Cocoa
import FlutterMacOS
import Security
import UniformTypeIdentifiers
import UserNotifications

class MainFlutterWindow: NSWindow {
  private static var deviceChannel: FlutterMethodChannel?
  private static var pendingDeepLink: String?
  private static var pendingDroppedFile: [String: Any]?
  private static let keychainService = "city.earthly.native"
  private static let keychainAccount = "settings_master_v1"
  private static let maxPickedAttachmentBytes = 25 * 1024 * 1024
  private static let circlesNotificationChannelId = "earthly_circles"
  private static let circlePayloadUserInfoKey = "circle_payload"
  private var accessedSecurityScopedUrls: [URL] = []

  deinit {
    for url in accessedSecurityScopedUrls {
      url.stopAccessingSecurityScopedResource()
    }
  }

  static func deliverDeepLink(_ uri: String) {
    if let channel = deviceChannel {
      DispatchQueue.main.async {
        channel.invokeMethod("onDeepLink", arguments: uri)
      }
    } else {
      pendingDeepLink = uri
    }
  }

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    registerDeviceChannel(controller: flutterViewController)
    registerForDraggedTypes([.fileURL])

    super.awakeFromNib()
  }

  private static let supportedDropExtensions: Set<String> = [
    "geojson", "json", "gpx", "kml", "pmtiles", "shp", "zip", "csv", "tsv"
  ]

  private func extractDroppedFileURL(_ sender: NSDraggingInfo) -> URL? {
    let pb = sender.draggingPasteboard
    guard let urls = pb.readObjects(forClasses: [NSURL.self], options: [
      .urlReadingFileURLsOnly: true
    ]) as? [URL] else {
      return nil
    }
    for url in urls {
      let ext = url.pathExtension.lowercased()
      if MainFlutterWindow.supportedDropExtensions.contains(ext) {
        return url
      }
    }
    return nil
  }

  func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    return extractDroppedFileURL(sender) != nil ? .copy : []
  }

  func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    guard let url = extractDroppedFileURL(sender) else {
      return false
    }
    do {
      let data = try Data(contentsOf: url)
      let ext = url.pathExtension.lowercased()
      let mime: String
      switch ext {
      case "gpx": mime = "application/gpx+xml"
      case "kml": mime = "application/vnd.google-earth.kml+xml"
      case "pmtiles": mime = "application/vnd.pmtiles"
      case "zip": mime = "application/zip"
      case "csv": mime = "text/csv"
      case "tsv": mime = "text/tab-separated-values"
      case "shp": mime = "application/octet-stream"
      default: mime = "application/geo+json"
      }
      let payload: [String: Any] = [
        "bytes": FlutterStandardTypedData(bytes: data),
        "mimeType": mime,
        "name": url.lastPathComponent,
        "path": url.path,
      ]
      if let channel = MainFlutterWindow.deviceChannel {
        DispatchQueue.main.async {
          channel.invokeMethod("onDroppedFile", arguments: payload)
        }
      } else {
        MainFlutterWindow.pendingDroppedFile = payload
      }
      return true
    } catch {
      return false
    }
  }

  private func registerDeviceChannel(controller: FlutterViewController) {
    let channel = FlutterMethodChannel(
      name: "city.earthly/device",
      binaryMessenger: controller.engine.binaryMessenger
    )
    MainFlutterWindow.deviceChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else {
        result(FlutterError(code: "disposed", message: "Window closed", details: nil))
        return
      }
      switch call.method {
      case "getInitialDeepLink":
        let link = MainFlutterWindow.pendingDeepLink
        MainFlutterWindow.pendingDeepLink = nil
        result(link)
      case "getInitialDroppedFile":
        let dropped = MainFlutterWindow.pendingDroppedFile
        MainFlutterWindow.pendingDroppedFile = nil
        result(dropped)
      case "pickPmtilesFile":
        self.openFilePanel(
          title: "Select Offline .pmtiles Archive",
          extensions: ["pmtiles"],
          fallbackMime: "application/vnd.pmtiles",
          result: result
        )
      case "pickGeoJsonFile":
        self.openFilePanel(
          title: "Import GeoJSON, GPX, KML, Shapefile, or CSV",
          extensions: ["geojson", "json", "gpx", "kml", "shp", "zip", "csv", "tsv"],
          fallbackMime: "application/geo+json",
          result: result
        )
      case "pickImage":
        self.openFilePanel(
          title: "Choose Photo",
          extensions: ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"],
          fallbackMime: "image/jpeg",
          allowAllImages: true,
          maxBytes: MainFlutterWindow.maxPickedAttachmentBytes,
          inferMime: true,
          result: result
        )
      case "pickAnyFile":
        self.openFilePanel(
          title: "Choose File",
          extensions: [],
          fallbackMime: "application/octet-stream",
          maxBytes: MainFlutterWindow.maxPickedAttachmentBytes,
          inferMime: true,
          result: result
        )
      case "showLocalNotification":
        self.handleShowLocalNotification(call: call, result: result)
      case "saveGeoJsonFile":
        let args = call.arguments as? [String: Any]
        let filename = (args?["filename"] as? String) ?? "earthly-map.geojson"
        let content = (args?["content"] as? String) ?? ""
        self.saveDataPanel(
          filename: filename,
          data: Data(content.utf8),
          fallbackExt: "geojson",
          title: "Export Earthly",
          result: result
        )
      case "saveBinaryFile":
        let args = call.arguments as? [String: Any]
        let filename = (args?["filename"] as? String) ?? "earthly-poster.png"
        let typed = args?["bytes"] as? FlutterStandardTypedData
        self.saveDataPanel(
          filename: filename,
          data: typed?.data ?? Data(),
          fallbackExt: "png",
          title: "Save Map Poster",
          result: result
        )
      case "shareText":
        let args = call.arguments as? [String: Any]
        let text = (args?["text"] as? String) ?? ""
        guard !text.isEmpty, let view = self.contentView else {
          result(false)
          return
        }
        DispatchQueue.main.async {
          let picker = NSSharingServicePicker(items: [text])
          let rect = NSRect(x: max(16, view.bounds.width - 120), y: max(16, view.bounds.height - 64), width: 1, height: 1)
          picker.show(relativeTo: rect, of: view, preferredEdge: .minY)
          result(true)
        }
      case "openExternalUri":
        let args = call.arguments as? [String: Any]
        let rawUri = (args?["uri"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !rawUri.isEmpty, let url = URL(string: rawUri) else {
          result(false)
          return
        }
        DispatchQueue.main.async {
          result(NSWorkspace.shared.open(url))
        }
      case "getOrCreateMasterKey":
        self.handleGetOrCreateMasterKey(result: result)
      case "createSecurityScopedBookmark":
        self.handleCreateSecurityScopedBookmark(call: call, result: result)
      case "resolveSecurityScopedBookmark":
        self.handleResolveSecurityScopedBookmark(call: call, result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private func readKeychainMasterKey() -> (status: OSStatus, data: Data?) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: MainFlutterWindow.keychainService,
      kSecAttrAccount as String: MainFlutterWindow.keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    return (status, item as? Data)
  }

  private func handleGetOrCreateMasterKey(result: FlutterResult) {
    let existing = readKeychainMasterKey()
    if existing.status == errSecSuccess {
      guard let data = existing.data, data.count == 32 else {
        result(FlutterError(
          code: "keychain_error",
          message: "Stored master key has invalid length",
          details: nil
        ))
        return
      }
      result(data.base64EncodedString())
      return
    }
    if existing.status != errSecItemNotFound {
      result(FlutterError(
        code: "keychain_error",
        message: "Failed to read master key from Keychain (\(existing.status))",
        details: nil
      ))
      return
    }

    var keyBytes = Data(count: 32)
    let rngStatus = keyBytes.withUnsafeMutableBytes { ptr -> Int32 in
      guard let baseAddress = ptr.baseAddress else { return errSecParam }
      return SecRandomCopyBytes(kSecRandomDefault, 32, baseAddress)
    }
    guard rngStatus == errSecSuccess else {
      result(FlutterError(
        code: "keychain_error",
        message: "Failed to generate random master key (\(rngStatus))",
        details: nil
      ))
      return
    }

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: MainFlutterWindow.keychainService,
      kSecAttrAccount as String: MainFlutterWindow.keychainAccount,
      kSecValueData as String: keyBytes,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    if addStatus == errSecSuccess {
      result(keyBytes.base64EncodedString())
      return
    }
    if addStatus == errSecDuplicateItem {
      let retry = readKeychainMasterKey()
      if retry.status == errSecSuccess, let data = retry.data, data.count == 32 {
        result(data.base64EncodedString())
        return
      }
    }
    result(FlutterError(
      code: "keychain_error",
      message: "Failed to store master key in Keychain (\(addStatus))",
      details: nil
    ))
  }

  private func handleCreateSecurityScopedBookmark(call: FlutterMethodCall, result: FlutterResult) {
    let args = call.arguments as? [String: Any]
    let rawPath = (args?["path"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !rawPath.isEmpty else {
      result(FlutterError(code: "invalid_args", message: "path is required", details: nil))
      return
    }
    let url = URL(fileURLWithPath: rawPath)
    do {
      let bookmarkData = try url.bookmarkData(
        options: .withSecurityScope,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )
      result(bookmarkData.base64EncodedString())
    } catch {
      result(FlutterError(code: "bookmark_error", message: error.localizedDescription, details: nil))
    }
  }

  private func handleResolveSecurityScopedBookmark(call: FlutterMethodCall, result: FlutterResult) {
    let args = call.arguments as? [String: Any]
    let rawBookmark = (args?["bookmark"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !rawBookmark.isEmpty, let bookmarkData = Data(base64Encoded: rawBookmark) else {
      result(FlutterError(code: "invalid_args", message: "Valid base64 bookmark is required", details: nil))
      return
    }
    do {
      var isStale = false
      let resolvedUrl = try URL(
        resolvingBookmarkData: bookmarkData,
        options: .withSecurityScope,
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
      )
      if resolvedUrl.startAccessingSecurityScopedResource() {
        accessedSecurityScopedUrls.append(resolvedUrl)
      }
      result(resolvedUrl.path)
    } catch {
      result(FlutterError(code: "bookmark_error", message: error.localizedDescription, details: nil))
    }
  }

  private func inferMimeType(for url: URL, fallback: String) -> String {
    let ext = url.pathExtension.lowercased()
    switch ext {
    case "geojson": return "application/geo+json"
    case "gpx": return "application/gpx+xml"
    case "kml": return "application/vnd.google-earth.kml+xml"
    case "pmtiles": return "application/vnd.pmtiles"
    case "webp": return "image/webp"
    case "heic": return "image/heic"
    case "heif": return "image/heif"
    default: break
    }
    if #available(macOS 11.0, *), !ext.isEmpty,
       let mime = UTType(filenameExtension: ext)?.preferredMIMEType,
       !mime.isEmpty {
      return mime
    }
    return fallback
  }

  private func normalizeCirclePayloadLink(_ rawPayload: String?) -> String? {
    guard let trimmed = rawPayload?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else {
      return nil
    }
    let lower = trimmed.lowercased()
    if lower.hasPrefix("earthly:") || lower.hasPrefix("nostr:") || lower.hasPrefix("geo:") {
      return trimmed
    }
    let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? trimmed
    return "earthly://circle/\(encoded)"
  }

  private func notificationCenterIfAvailable() -> UNUserNotificationCenter? {
    guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil,
          let bundleId = Bundle.main.bundleIdentifier,
          !bundleId.isEmpty,
          Bundle.main.bundleURL.pathExtension == "app" else {
      return nil
    }
    return UNUserNotificationCenter.current()
  }

  private func handleShowLocalNotification(call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any]
    let title = (args?["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let body = (args?["body"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !title.isEmpty || !body.isEmpty else {
      result(false)
      return
    }
    let rawChannel = (args?["channelId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let channelId = rawChannel.isEmpty ? MainFlutterWindow.circlesNotificationChannelId : rawChannel
    let deepLink = normalizeCirclePayloadLink(args?["payload"] as? String)

    guard let center = notificationCenterIfAvailable() else {
      result(false)
      return
    }
    if center.delegate == nil {
      center.delegate = self
    }

    center.getNotificationSettings { [weak self] settings in
      guard let self = self else {
        DispatchQueue.main.async { result(false) }
        return
      }
      switch settings.authorizationStatus {
      case .authorized, .provisional:
        self.enqueueUserNotification(
          center: center,
          title: title,
          body: body,
          channelId: channelId,
          deepLink: deepLink,
          result: result
        )
      case .notDetermined:
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, error in
          guard let self = self, granted, error == nil else {
            DispatchQueue.main.async { result(false) }
            return
          }
          self.enqueueUserNotification(
            center: center,
            title: title,
            body: body,
            channelId: channelId,
            deepLink: deepLink,
            result: result
          )
        }
      default:
        DispatchQueue.main.async { result(false) }
      }
    }
  }

  private func enqueueUserNotification(
    center: UNUserNotificationCenter,
    title: String,
    body: String,
    channelId: String,
    deepLink: String?,
    result: @escaping FlutterResult
  ) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    content.threadIdentifier = channelId
    if let deepLink = deepLink {
      content.userInfo[MainFlutterWindow.circlePayloadUserInfoKey] = deepLink
    }
    let request = UNNotificationRequest(
      identifier: "earthly-circle-\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    center.add(request) { error in
      DispatchQueue.main.async {
        result(error == nil)
      }
    }
  }

  private func openFilePanel(
    title: String,
    extensions: [String],
    fallbackMime: String,
    allowAllImages: Bool = false,
    maxBytes: Int? = nil,
    inferMime: Bool = false,
    result: @escaping FlutterResult
  ) {
    DispatchQueue.main.async {
      let panel = NSOpenPanel()
      panel.title = title
      panel.canChooseFiles = true
      panel.canChooseDirectories = false
      panel.allowsMultipleSelection = false
      if #available(macOS 11.0, *) {
        if allowAllImages {
          panel.allowedContentTypes = [.image]
        } else {
          let types = extensions.compactMap { UTType(filenameExtension: $0) }
          if !types.isEmpty {
            panel.allowedContentTypes = types
          }
        }
      }
      panel.beginSheetModal(for: self) { response in
        guard response == .OK, let url = panel.url else {
          result(FlutterError(code: "cancelled", message: "File selection cancelled", details: nil))
          return
        }
        do {
          if let limit = maxBytes {
            let resourceValues = try? url.resourceValues(forKeys: [.fileSizeKey])
            if let fileSize = resourceValues?.fileSize, fileSize > limit {
              result(FlutterError(
                code: "file_too_large",
                message: "Selected file exceeds the \(limit / (1024 * 1024)) MB limit",
                details: nil
              ))
              return
            }
          }
          let data = try Data(contentsOf: url)
          if data.isEmpty {
            result(FlutterError(code: "empty_file", message: "Selected file was empty", details: nil))
            return
          }
          if let limit = maxBytes, data.count > limit {
            result(FlutterError(
              code: "file_too_large",
              message: "Selected file exceeds the \(limit / (1024 * 1024)) MB limit",
              details: nil
            ))
            return
          }
          let mimeType = inferMime ? self.inferMimeType(for: url, fallback: fallbackMime) : fallbackMime
          result([
            "bytes": FlutterStandardTypedData(bytes: data),
            "mimeType": mimeType,
            "name": url.lastPathComponent,
          ])
        } catch {
          result(FlutterError(code: "read_failed", message: error.localizedDescription, details: nil))
        }
      }
    }
  }

  private func saveDataPanel(
    filename: String,
    data: Data,
    fallbackExt: String,
    title: String,
    result: @escaping FlutterResult
  ) {
    DispatchQueue.main.async {
      let panel = NSSavePanel()
      let ext = (filename as NSString).pathExtension.lowercased()
      panel.title = "\(title) \(ext.isEmpty ? fallbackExt.uppercased() : ext.uppercased())"
      panel.nameFieldStringValue = filename
      if #available(macOS 11.0, *) {
        let targetExt = ext.isEmpty ? fallbackExt : ext
        if let fileType = UTType(filenameExtension: targetExt) {
          panel.allowedContentTypes = [fileType]
        }
      }
      panel.beginSheetModal(for: self) { response in
        guard response == .OK, let url = panel.url else {
          result(FlutterError(code: "cancelled", message: "Export cancelled", details: nil))
          return
        }
        do {
          try data.write(to: url, options: .atomic)
          result(url.lastPathComponent)
        } catch {
          result(FlutterError(code: "write_failed", message: error.localizedDescription, details: nil))
        }
      }
    }
  }
}

extension MainFlutterWindow: UNUserNotificationCenterDelegate {
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(macOS 11.0, *) {
      completionHandler([.banner, .list, .sound])
    } else {
      completionHandler([.alert, .sound])
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let rawPayload = response.notification.request.content.userInfo[
      MainFlutterWindow.circlePayloadUserInfoKey
    ] as? String
    if let deepLink = normalizeCirclePayloadLink(rawPayload) {
      DispatchQueue.main.async {
        if #available(macOS 14.0, *) {
          NSApp.activate()
        } else {
          NSApp.activate(ignoringOtherApps: true)
        }
        self.makeKeyAndOrderFront(nil)
        MainFlutterWindow.deliverDeepLink(deepLink)
      }
    }
    completionHandler()
  }
}
