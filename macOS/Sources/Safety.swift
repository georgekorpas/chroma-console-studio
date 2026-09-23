import Foundation
import CoreFoundation

enum ChromaError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

enum Safety {
    static let controls: Set<Int> = [16,17,18,19,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,91,92,93,94,95,103,104,105,106]
    static let presetControls: Set<Int> = [16,17,18,19,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,83,84]
    static func integer(_ value: Any?, _ range: ClosedRange<Int>) throws -> Int {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              n.doubleValue.isFinite, n.doubleValue.rounded() == n.doubleValue,
              n.doubleValue >= Double(range.lowerBound), n.doubleValue <= Double(range.upperBound)
        else { throw ChromaError.message("Invalid MIDI or preset value.") }
        return n.intValue
    }
    static func normalDevice(name: String, manufacturer: String) -> Bool {
        let combined = (name + " " + manufacturer).lowercased()
        return name.range(of: "chroma\\s*console", options: .regularExpression.union(.caseInsensitive)) != nil
            && !["boot", "firmware", "dfu", "update"].contains(where: combined.contains)
    }
    // The native boundary accepts these two operations only, never a byte array.
    static func command(_ request: [String: Any]) throws -> [UInt8] {
        let channel = try integer(request["channel"], 1...16)
        switch request["op"] as? String {
        case "cc":
            let cc = try integer(request["cc"], 0...127)
            guard controls.contains(cc) else { throw ChromaError.message("This MIDI controller is not allowed.") }
            let value = try integer(request["value"], 0...127)
            return [UInt8(0xb0 + channel - 1), UInt8(cc), UInt8(value)]
        case "program":
            let program = try integer(request["program"], 0...79)
            return [UInt8(0xc0 + channel - 1), UInt8(program)]
        default: throw ChromaError.message("Unsupported MIDI operation.")
        }
    }
    static func object(_ text: String) throws -> [String: Any] {
        guard text.utf8.count <= 1_000_000, let data = text.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw ChromaError.message("Invalid or oversized preset file.") }
        return object
    }
    static func preset(_ value: Any?, allowEmptyName: Bool = false) throws {
        guard let p = value as? [String: Any], let name = p["name"] as? String,
              name.utf16.count <= 80, (allowEmptyName || !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
              let values = p["values"] as? [String: Any]
        else { throw ChromaError.message("Invalid preset.") }
        if !(p["baseProgram"] is NSNull) { _ = try integer(p["baseProgram"], 0...79) }
        if let notes = p["notes"] { guard let notes = notes as? String, notes.utf16.count <= 2000 else { throw ChromaError.message("Invalid preset notes.") } }
        for (key, value) in values {
            guard let cc = Int(key), String(cc) == key, presetControls.contains(cc) else { throw ChromaError.message("Preset contains an unsupported control.") }
            _ = try integer(value, 0...127)
        }
    }
    static func library(_ text: String) throws {
        let object = try object(text)
        guard object["format"] as? String == "chroma-console-editor", try integer(object["version"], 1...1) == 1,
              let presets = object["presets"] as? [Any], presets.count <= 500
        else { throw ChromaError.message("Unsupported preset library.") }
        for item in presets { try preset(item) }
    }
    static func session(_ text: String) throws {
        let object = try object(text)
        guard object["format"] as? String == "chroma-session", try integer(object["version"], 1...1) == 1 else { throw ChromaError.message("Unsupported session.") }
        try preset(object["draft"], allowEmptyName: true)
        _ = try integer(object["channel"], 1...16)
        _ = try integer(object["bank"], 0...3)
        guard let page = object["page"] as? String, ["editor","presets","performance","activity","guide"].contains(page),
              let mode = object["moduleBypass"] as? NSNumber, CFGetTypeID(mode) == CFBooleanGetTypeID()
        else { throw ChromaError.message("Invalid session settings.") }
    }
}
