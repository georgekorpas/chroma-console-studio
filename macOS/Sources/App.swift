import AppKit
import WebKit
import UniformTypeIdentifiers

final class AppResources: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("Web")
    private let files: Set<String> = ["index.html","style.css","app.mjs","protocol.mjs","desktop.mjs","tests/index.html","tests/tests.mjs","tests/live-ui.mjs"]
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == "chroma", url.host == "app" else { task.didFailWithError(URLError(.badURL)); return }
        var path = String(url.path.dropFirst())
        if path.isEmpty { path = "index.html" }; if path == "tests/" { path = "tests/index.html" }
        guard files.contains(path) else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
        do {
            let data = try Data(contentsOf: root.appendingPathComponent(path))
            let mime = path.hasSuffix(".css") ? "text/css" : path.hasSuffix(".mjs") ? "text/javascript" : "text/html"
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": mime + "; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
            ])!
            task.didReceive(response); task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var store: PresetStore!
    private let midi = MIDIService()
    private var simulation = Bundle.main.object(forInfoDictionaryKey:"ChromaStartInSimulator") as? Bool ?? false
    private let releaseVersion = Bundle.main.object(forInfoDictionaryKey: "ChromaReleaseVersion") as? String ?? "Unknown"
    private let buildNumber = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
    private var ready = false
    private var terminationApproved = false
    private var diagnostics: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { store = try PresetStore() } catch { NSApplication.shared.presentError(error); NSApplication.shared.terminate(nil); return }
        store.onError = { [weak self] error in self?.emit("error", ["message": error.localizedDescription]) }
        midi.onPorts = { [weak self] payload in self?.emit("ports", payload) }
        midi.onInput = { [weak self] payload in self?.emit("input", payload) }
        midi.onError = { [weak self] error in self?.emit("error", ["message": error.localizedDescription]) }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(willSleep), name: NSWorkspace.willSleepNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(AppResources(), forURLScheme: "chroma")
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "chroma")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        web.underPageBackgroundColor = NSColor(srgbRed: 0.067, green: 0.075, blue: 0.082, alpha: 1)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1660, height: 1000), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "Chroma Console"; window.subtitle = "Studio · v\(releaseVersion)"
        window.contentView = web; window.delegate = self
        window.minSize = NSSize(width: 900, height: 620)
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = web.underPageBackgroundColor
        window.isReleasedWhenClosed = false
        window.center(); window.setFrameAutosaveName("ChromaConsoleStudioWindow")
        makeMenus()
        loadEditor()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
    private func loadEditor() {
        ready = false
        window.subtitle = (simulation ? "Simulator · no hardware" : "Studio") + " · v\(releaseVersion)"
        web.load(URLRequest(url: URL(string: "chroma://app/index.html" + (simulation ? "?demo=1" : "") + "#editor")!))
    }
    private func emit(_ kind: String, _ payload: [String: Any]) {
        guard ready, let data = try? JSONSerialization.data(withJSONObject: ["kind":kind,"payload":payload]), let json = String(data:data, encoding:.utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('chroma-native',{detail:\(json)}))", completionHandler: nil)
    }
    private func validFrame(_ message: WKScriptMessage) -> Bool {
        let url = message.frameInfo.request.url
        return message.frameInfo.isMainFrame && message.webView === web && url?.scheme == "chroma" && url?.host == "app" && url?.path == "/index.html"
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard validFrame(message), let body = message.body as? [String:Any], let op = body["op"] as? String else { replyHandler(nil,"Unsupported app request."); return }
        do {
            switch op {
            case "init":
                replyHandler(["version":releaseVersion, "buildNumber":buildNumber, "library": simulation ? NSNull() : (try store.read("library") as Any? ?? NSNull()), "session": simulation ? NSNull() : (try store.read("session") as Any? ?? NSNull()), "simulation":simulation], nil)
            case "ready": ready = true; replyHandler(true,nil)
            case "ports":
                guard !simulation else { throw ChromaError.message("Simulator cannot access MIDI hardware.") }
                replyHandler(try midi.ports(),nil)
            case "cc", "program":
                guard !simulation else { throw ChromaError.message("Simulator cannot send to hardware.") }
                try midi.send(body); replyHandler(true,nil)
            case "saveLibrary":
                guard !simulation, let text = body["text"] as? String else { throw ChromaError.message("Invalid library request.") }
                try store.saveLibrary(text); replyHandler(true,nil)
            case "saveSession":
                guard !simulation, let text = body["text"] as? String else { throw ChromaError.message("Invalid session request.") }
                try store.saveSession(text); replyHandler(true,nil)
            case "flush": try store.flush(); replyHandler(true,nil)
            case "importLibrary": importLibrary(replyHandler)
            case "exportLibrary":
                guard let text = body["text"] as? String else { throw ChromaError.message("Missing preset data.") }
                try Safety.library(text); exportLibrary(text, replyHandler)
            case "showLibrary": NSWorkspace.shared.open(store.directory); replyHandler(true,nil)
            default: throw ChromaError.message("Unsupported app operation.")
            }
        } catch { replyHandler(nil,error.localizedDescription) }
    }
    private func importLibrary(_ reply: @escaping (Any?,String?) -> Void) {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.message = "Import a Chroma Console preset library. This does not send settings to the pedal."
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { reply(NSNull(),nil); return }
            do {
                let size = try url.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
                guard size <= 1_000_000 else { throw ChromaError.message("Library exceeds 1 MB.") }
                let text = try String(contentsOf:url,encoding:.utf8); try Safety.library(text); reply(text,nil)
            } catch { reply(nil,error.localizedDescription) }
        }
    }
    private func exportLibrary(_ text: String, _ reply: @escaping (Any?,String?) -> Void) {
        let panel = NSSavePanel(); panel.allowedContentTypes = [.json]; panel.nameFieldStringValue = "Chroma Presets.json"
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { reply(false,nil); return }
            do { try text.write(to:url,atomically:true,encoding:.utf8); reply(true,nil) } catch { reply(nil,error.localizedDescription) }
        }
    }
    private func makeMenus() {
        let main = NSMenu()
        func menu(_ title: String) -> NSMenu { let item = NSMenuItem(); let menu = NSMenu(title:title); item.submenu = menu; main.addItem(item); return menu }
        func item(_ menu: NSMenu, _ title: String, _ selector: Selector, _ key: String = "", _ tag: Int = 0) { let item = NSMenuItem(title:title,action:selector,keyEquivalent:key); item.target = self; item.tag = tag; menu.addItem(item) }
        let app = menu("Chroma Console")
        item(app,"About Chroma Console",#selector(about)); app.addItem(.separator())
        item(app,"Settings…",#selector(navigate(_:)),",",4); app.addItem(.separator())
        app.addItem(withTitle:"Hide Chroma Console",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h")
        let others = app.addItem(withTitle:"Hide Others",action:#selector(NSApplication.hideOtherApplications(_:)),keyEquivalent:"h"); others.keyEquivalentModifierMask = [.command,.option]
        app.addItem(withTitle:"Show All",action:#selector(NSApplication.unhideAllApplications(_:)),keyEquivalent:""); app.addItem(.separator())
        app.addItem(withTitle:"Quit Chroma Console",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let file = menu("File")
        item(file,"Save Preset…",#selector(command(_:)),"s",1)
        item(file,"Import Preset Library…",#selector(command(_:)),"o",2)
        item(file,"Export Preset Library…",#selector(command(_:)),"e",3)
        file.addItem(.separator()); item(file,"Show Preset Files",#selector(showLibrary))
        file.addItem(.separator()); file.addItem(withTitle:"Close Window",action:#selector(NSWindow.performClose(_:)),keyEquivalent:"w")
        let edit = menu("Edit")
        for (title, action, key) in [("Undo","undo:","z"),("Redo","redo:","Z"),("Cut","cut:","x"),("Copy","copy:","c"),("Paste","paste:","v"),("Select All","selectAll:","a")] { edit.addItem(withTitle:title,action:Selector(action),keyEquivalent:key) }
        let view = menu("View")
        for (i,title) in ["Sound","Presets","Performance","MIDI Activity","Settings & Help"].enumerated() { item(view,title,#selector(navigate(_:)),String(i+1),i) }
        view.addItem(.separator()); item(view,"Larger Controls",#selector(zoom(_:)),"+",1); item(view,"Smaller Controls",#selector(zoom(_:)),"-",-1); item(view,"Actual Size",#selector(zoom(_:)),"0",0)
        let device = menu("Device")
        item(device,"Refresh MIDI Connection",#selector(command(_:)),"r",4)
        item(device,"Disconnect",#selector(command(_:)),"",5)
        let help = menu("Help")
        item(help,"Chroma Console Manual",#selector(manual))
        item(help,"Protocol Diagnostics",#selector(protocolTests))
        item(help,simulation ? "Return to Physical Pedal" : "Use Simulator",#selector(toggleSimulation(_:)))
        let windows = menu("Window"); windows.addItem(withTitle:"Minimize",action:#selector(NSWindow.performMiniaturize(_:)),keyEquivalent:"m"); windows.addItem(withTitle:"Zoom",action:#selector(NSWindow.performZoom(_:)),keyEquivalent:"")
        NSApplication.shared.windowsMenu = windows; NSApplication.shared.mainMenu = main
    }
    @objc private func about() {
        NSApplication.shared.orderFrontStandardAboutPanel(options:[.applicationName:"Chroma Console",.applicationVersion:releaseVersion,.version:buildNumber,.credits:NSAttributedString(string:"Independent MIDI editor for Hologram Electronics Chroma Console.\nDocumented controls only. No firmware or bootloader access.")])
    }
    @objc private func navigate(_ sender:NSMenuItem) { emit("menu",["action":"page","page":["editor","presets","performance","activity","guide"][sender.tag]]) }
    @objc private func command(_ sender:NSMenuItem) { emit("menu",["action":[1:"save",2:"import",3:"export",4:"connect",5:"disconnect"][sender.tag]!]) }
    @objc private func zoom(_ sender:NSMenuItem) { web.pageZoom = sender.tag == 0 ? 1 : min(1.5,max(0.8,web.pageZoom + Double(sender.tag)*0.1)) }
    @objc private func showLibrary() { NSWorkspace.shared.open(store.directory) }
    @objc private func manual() { NSWorkspace.shared.open(URL(string:"https://www.hologramelectronics.com/pages/chroma-console-manual")!) }
    @objc private func willSleep() { midi.setSuspended(true) }
    @objc private func didWake() { if !simulation { midi.setSuspended(false) } }
    @objc private func toggleSimulation(_ sender:NSMenuItem) {
        flushSession { [weak self] ok in
            guard let self, ok else { return }
            self.simulation.toggle(); self.midi.setSuspended(self.simulation)
            sender.title = self.simulation ? "Return to Physical Pedal" : "Use Simulator"
            self.loadEditor()
        }
    }
    @objc private func protocolTests() {
        if let diagnostics { diagnostics.makeKeyAndOrderFront(nil); return }
        let configuration = WKWebViewConfiguration(); configuration.setURLSchemeHandler(AppResources(),forURLScheme:"chroma")
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame:.zero,configuration:configuration); view.navigationDelegate = self
        let win = NSWindow(contentRect:NSRect(x:0,y:0,width:930,height:650),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
        win.title = "Protocol Diagnostics · No Hardware Access"; win.contentView = view; win.isReleasedWhenClosed = false; win.center()
        view.load(URLRequest(url:URL(string:"chroma://app/tests/index.html")!)); diagnostics = win; win.makeKeyAndOrderFront(nil)
    }
    private func flushSession(_ completion:@escaping (Bool)->Void) {
        guard ready else { completion(true); return }
        web.callAsyncJavaScript("return await window.chromaFlushSession?.()", arguments:[:], in:nil, in:.page) { [weak self] result in
            switch result {
            case .success:
                do { try self?.store.flush(); completion(true) } catch { NSApplication.shared.presentError(error); completion(false) }
            case .failure(let error): NSApplication.shared.presentError(error); completion(false)
            }
        }
    }
    func applicationShouldTerminate(_ sender:NSApplication) -> NSApplication.TerminateReply {
        if terminationApproved { return .terminateNow }
        flushSession { [weak self] ok in self?.terminationApproved = ok; NSApplication.shared.reply(toApplicationShouldTerminate:ok) }
        return .terminateLater
    }
    func windowShouldClose(_ sender:NSWindow) -> Bool { NSApplication.shared.terminate(nil); return false }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool { window.makeKeyAndOrderFront(nil); return true }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if webView !== web {
            let interfaceTest = url.path == "/index.html" && url.query == "demo=1&test=ui"
            if url.scheme == "chroma" && url.host == "app" && (url.path == "/tests/index.html" || interfaceTest) { decisionHandler(.allow) }
            else { diagnostics?.close(); window.makeKeyAndOrderFront(nil); decisionHandler(.cancel) }; return
        }
        if url.scheme == "chroma", url.host == "app", action.targetFrame?.isMainFrame != false {
            if url.path == "/tests/" || url.path == "/tests/index.html" { protocolTests(); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else {
            if action.navigationType == .linkActivated, ["https","http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for action:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? { nil }
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error) { NSApplication.shared.presentError(error) }
}

@main @MainActor
struct ChromaApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.regular); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
