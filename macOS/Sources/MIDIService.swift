import Foundation
import CoreMIDI

// Receives only MIDI 1.0 CC, Program Change and clock. Other UMPs, including
// System Exclusive, are skipped and are never forwarded to the web view.
enum MIDIInputDecoder {
    static func decode(_ words: [UInt32]) -> [[UInt8]] {
        let lengths = [1,1,1,2,2,4,1,1,2,2,2,3,3,4,4,4]
        var result: [[UInt8]] = [], index = 0
        while index < words.count {
            let word = words[index], type = Int(word >> 28), length = lengths[type]
            guard index + length <= words.count else { break }
            let status = UInt8((word >> 16) & 0xff)
            if type == 1 && status == 0xf8 { result.append([0xf8]) }
            if type == 2 {
                let first = UInt8((word >> 8) & 0xff), second = UInt8(word & 0xff)
                if status & 0xf0 == 0xb0 && Safety.controls.contains(Int(first)) && second < 128 { result.append([status, first, second]) }
                if status & 0xf0 == 0xc0 && first < 80 { result.append([status, first]) }
            }
            index += length
        }
        return result
    }
}

final class MIDIService {
    private var client: MIDIClientRef = 0
    private var input: MIDIPortRef = 0
    private var output: MIDIPortRef = 0
    private var sources: Set<MIDIEndpointRef> = []
    private var destinations: [String: MIDIEndpointRef] = [:]
    private var sourceIDs: [MIDIEndpointRef: String] = [:]
    private var inventory: [[String: Any]] = []
    private var signature = ""
    private(set) var generation = 0
    private var timer: Timer?
    private var received: [[String: Any]] = []
    private var clocks: [String: Int] = [:]
    private(set) var sent = 0
    var suspended = false
    var onPorts: (([String: Any]) -> Void)?
    var onInput: (([String: Any]) -> Void)?
    var onError: ((Error) -> Void)?

    private func check(_ status: OSStatus, _ description: String) throws {
        guard status == noErr else { throw ChromaError.message("\(description) (CoreMIDI \(status)).") }
    }
    private func start() throws {
        guard client == 0 else { return }
        try check(MIDIClientCreateWithBlock("Chroma Console Studio" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async { self?.refreshAndNotify() }
        }, "Cannot start MIDI")
        do {
            try check(MIDIOutputPortCreate(client, "Documented controls" as CFString, &output), "Cannot create MIDI output")
            try check(MIDIInputPortCreateWithProtocol(client, "Pedal feedback" as CFString, ._1_0, &input) { [weak self] list, context in
                let endpoint = MIDIEndpointRef(UInt(bitPattern: context))
                var messages: [[UInt8]] = []
                var packet = UnsafeRawPointer(list).advanced(by: MemoryLayout<MIDIEventList>.offset(of: \.packet)!).assumingMemoryBound(to: MIDIEventPacket.self)
                for _ in 0..<list.pointee.numPackets {
                    let words = UnsafeRawPointer(packet).advanced(by: MemoryLayout<MIDIEventPacket>.offset(of: \.words)!).assumingMemoryBound(to: UInt32.self)
                    messages.append(contentsOf: MIDIInputDecoder.decode(Array(UnsafeBufferPointer(start: words, count: Int(packet.pointee.wordCount)))))
                    packet = UnsafePointer(MIDIEventPacketNext(packet))
                }
                guard !messages.isEmpty else { return }
                let captured = messages
                DispatchQueue.main.async { self?.receive(captured, from: endpoint) }
            }, "Cannot create MIDI input")
        } catch { if client != 0 { MIDIClientDispose(client) }; client = 0; input = 0; output = 0; throw error }
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.flushInput() }
    }
    private func property(_ object: MIDIObjectRef, _ key: CFString) -> String {
        var value: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(object, key, &value) == noErr else { return "" }
        return value?.takeRetainedValue() as String? ?? ""
    }
    private func describe(_ endpoint: MIDIEndpointRef, _ type: String) -> [String: Any]? {
        guard endpoint != 0 else { return nil }
        var offline: Int32 = 0
        MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyOffline, &offline)
        guard offline == 0 else { return nil }
        let display = property(endpoint, kMIDIPropertyDisplayName), plain = property(endpoint, kMIDIPropertyName)
        let name = display.isEmpty ? plain : display
        var maker = property(endpoint, kMIDIPropertyManufacturer)
        var entity: MIDIEntityRef = 0, device: MIDIDeviceRef = 0
        if maker.isEmpty, MIDIEndpointGetEntity(endpoint, &entity) == noErr, MIDIEntityGetDevice(entity, &device) == noErr {
            maker = property(device, kMIDIPropertyManufacturer)
        }
        guard Safety.normalDevice(name: name, manufacturer: maker) else { return nil }
        var unique: Int32 = 0
        MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &unique)
        return ["id": "\(type)-\(unique == 0 ? Int64(endpoint) : Int64(unique))", "name": name, "manufacturer": maker, "type": type, "state": "connected"]
    }
    func ports() throws -> [String: Any] {
        try start()
        try refresh()
        return ["ports": inventory, "generation": generation]
    }
    private func refresh() throws {
        var next: [[String: Any]] = [], nextSources: Set<MIDIEndpointRef> = [], nextDestinations: [String: MIDIEndpointRef] = [:], nextIDs: [MIDIEndpointRef: String] = [:]
        if !suspended {
            for i in 0..<MIDIGetNumberOfDestinations() {
                let endpoint = MIDIGetDestination(i)
                if let info = describe(endpoint, "output"), let id = info["id"] as? String { next.append(info); nextDestinations[id] = endpoint }
            }
            for i in 0..<MIDIGetNumberOfSources() {
                let endpoint = MIDIGetSource(i)
                if let info = describe(endpoint, "input"), let id = info["id"] as? String { next.append(info); nextSources.insert(endpoint); nextIDs[endpoint] = id }
            }
        }
        for endpoint in sources.subtracting(nextSources) { MIDIPortDisconnectSource(input, endpoint) }
        for endpoint in nextSources.subtracting(sources) {
            try check(MIDIPortConnectSource(input, endpoint, UnsafeMutableRawPointer(bitPattern: UInt(endpoint))), "Cannot listen to pedal input")
        }
        sources = nextSources; sourceIDs = nextIDs; destinations = nextDestinations
        let nextSignature = String(data: try JSONSerialization.data(withJSONObject: next, options: .sortedKeys), encoding: .utf8)!
        if nextSignature != signature { generation += 1; signature = nextSignature; received.removeAll(); clocks.removeAll() }
        inventory = next
    }
    func refreshAndNotify() {
        guard client != 0 else { return }
        do { try refresh(); onPorts?(["ports": inventory, "generation": generation]) } catch { onError?(error) }
    }
    func setSuspended(_ value: Bool) {
        suspended = value
        generation += 1
        refreshAndNotify()
    }
    func send(_ request: [String: Any]) throws {
        let bytes = try Safety.command(request)
        guard !suspended, client != 0, let id = request["id"] as? String,
              try Safety.integer(request["generation"], 0...Int.max) == generation,
              let endpoint = destinations[id], let current = describe(endpoint, "output"), current["id"] as? String == id
        else { throw ChromaError.message("The pedal connection changed. Reconnect before sending controls.") }
        // Construct exactly one MIDI 1.0 channel-voice UMP. No general send API.
        var word = UInt32(0x20000000) | UInt32(bytes[0]) << 16 | UInt32(bytes[1]) << 8 | UInt32(bytes.count == 3 ? bytes[2] : 0)
        var events = MIDIEventList()
        let status = withUnsafeMutablePointer(to: &events) { list -> OSStatus in
            let packet = MIDIEventListInit(list, ._1_0)
            _ = MIDIEventListAdd(list, MemoryLayout<MIDIEventList>.size, packet, 0, 1, &word)
            return MIDISendEventList(output, endpoint, list)
        }
        try check(status, "The MIDI control could not be sent")
        sent += 1
    }
    private func receive(_ messages: [[UInt8]], from endpoint: MIDIEndpointRef) {
        guard !suspended, let id = sourceIDs[endpoint] else { return }
        for bytes in messages {
            if bytes == [0xf8] { clocks[id, default: 0] += 1 }
            else if received.count < 256 { received.append(["id": id, "data": bytes.map(Int.init)]) }
        }
    }
    private func flushInput() {
        guard !received.isEmpty || !clocks.isEmpty else { return }
        onInput?(["messages": received, "clocks": clocks, "generation": generation])
        received.removeAll(keepingCapacity: true); clocks.removeAll(keepingCapacity: true)
    }
    deinit { timer?.invalidate(); if client != 0 { MIDIClientDispose(client) } }
}
