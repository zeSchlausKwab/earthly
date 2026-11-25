import Cocoa
import FlutterMacOS
import UniformTypeIdentifiers

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    registerDeviceChannel(controller: flutterViewController)

    super.awakeFromNib()
  }

  private func registerDeviceChannel(controller: FlutterViewController) {
    let channel = FlutterMethodChannel(
      name: "city.earthly/device",
      binaryMessenger: controller.engine.binaryMessenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else {
        result(FlutterError(code: "disposed", message: "Window closed", details: nil))
        return
      }
      switch call.method {
      case "pickPmtilesFile":
        self.openFilePanel(
          title: "Select Offline .pmtiles Archive",
          extensions: ["pmtiles"],
          fallbackMime: "application/vnd.pmtiles",
          result: result
        )
      case "pickGeoJsonFile":
        self.openFilePanel(
          title: "Import GeoJSON File",
          extensions: ["geojson", "json"],
          fallbackMime: "application/geo+json",
          result: result
        )
      case "pickImage":
        self.openFilePanel(
          title: "Choose Field Photo",
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
      panel.title = "Export Earthly GeoJSON"
      panel.nameFieldStringValue = filename
      if #available(macOS 11.0, *) {
        if let geoType = UTType(filenameExtension: "geojson") {
          panel.allowedContentTypes = [geoType]
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
