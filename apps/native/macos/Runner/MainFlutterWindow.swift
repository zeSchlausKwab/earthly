import Cocoa
import FlutterMacOS
import UniformTypeIdentifiers

class MainFlutterWindow: NSWindow {
  private static var deviceChannel: FlutterMethodChannel?
  private static var pendingDeepLink: String?
  private static var pendingDroppedFile: [String: Any]?

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
    "geojson", "json", "gpx", "kml", "pmtiles"
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
          title: "Import GeoJSON, GPX, or KML File",
          extensions: ["geojson", "json", "gpx", "kml"],
          fallbackMime: "application/geo+json",
          result: result
        )
      case "pickImage":
        self.openFilePanel(
          title: "Choose Photo",
          extensions: ["jpg", "jpeg", "png", "webp", "heic"],
          fallbackMime: "image/jpeg",
          result: result
        )
      case "saveGeoJsonFile":
        let args = call.arguments as? [String: Any]
        let filename = (args?["filename"] as? String) ?? "earthly-map.geojson"
        let content = (args?["content"] as? String) ?? ""
        self.saveGeoJsonPanel(filename: filename, content: content, result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private func openFilePanel(
    title: String,
    extensions: [String],
    fallbackMime: String,
    result: @escaping FlutterResult
  ) {
    DispatchQueue.main.async {
      let panel = NSOpenPanel()
      panel.title = title
      panel.canChooseFiles = true
      panel.canChooseDirectories = false
      panel.allowsMultipleSelection = false
      if #available(macOS 11.0, *) {
        let types = extensions.compactMap { UTType(filenameExtension: $0) }
        if !types.isEmpty {
          panel.allowedContentTypes = types
        }
      }
      panel.beginSheetModal(for: self) { response in
        guard response == .OK, let url = panel.url else {
          result(FlutterError(code: "cancelled", message: "File selection cancelled", details: nil))
          return
        }
        do {
          let data = try Data(contentsOf: url)
          result([
            "bytes": FlutterStandardTypedData(bytes: data),
            "mimeType": fallbackMime,
            "name": url.lastPathComponent,
          ])
        } catch {
          result(FlutterError(code: "read_failed", message: error.localizedDescription, details: nil))
        }
      }
    }
  }

  private func saveGeoJsonPanel(
    filename: String,
    content: String,
    result: @escaping FlutterResult
  ) {
    DispatchQueue.main.async {
      let panel = NSSavePanel()
      let ext = (filename as NSString).pathExtension.lowercased()
      panel.title = "Export Earthly \(ext.isEmpty ? "GEOJSON" : ext.uppercased())"
      panel.nameFieldStringValue = filename
      if #available(macOS 11.0, *) {
        let targetExt = ext.isEmpty ? "geojson" : ext
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
          try content.write(to: url, atomically: true, encoding: .utf8)
          result(url.lastPathComponent)
        } catch {
          result(FlutterError(code: "write_failed", message: error.localizedDescription, details: nil))
        }
      }
    }
  }
}
