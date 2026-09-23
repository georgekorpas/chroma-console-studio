import Foundation

@main struct NativeTests {
    static var passed = 0
    static func check(_ value: Bool, _ label: String) { precondition(value,label); passed += 1 }
    static func rejects(_ action: () throws -> Void) -> Bool { do { try action(); return false } catch { return true } }
    static func main() throws {
        for channel in 1...16 { for cc in 0...127 { for value in 0...127 {
            let request: [String:Any] = ["op":"cc","channel":channel,"cc":cc,"value":value]
            if Safety.controls.contains(cc) { let bytes = try Safety.command(request); precondition(bytes == [UInt8(175+channel),UInt8(cc),UInt8(value)]) }
            else { precondition(rejects { _ = try Safety.command(request) }) }
        } } }
        check(true,"Exhaustive native CC allowlist")
        for channel in 1...16 { for pc in 0...127 {
            let request: [String:Any] = ["op":"program","channel":channel,"program":pc]
            if pc < 80 { let bytes = try Safety.command(request); precondition(bytes == [UInt8(191+channel),UInt8(pc)]) } else { precondition(rejects { _ = try Safety.command(request) }) }
        } }
        check(true,"Program boundaries")
        for op in ["sysex","send","raw","reset","firmware","bootloader"] { check(rejects { _ = try Safety.command(["op":op,"channel":1,"data":[240,0,247]]) },"Raw operation rejected") }
        for value in [true,false,"1",1.5,128,-1,NSNull()] as [Any] { check(rejects { _ = try Safety.command(["op":"cc","channel":1,"cc":64,"value":value]) },"Malformed value rejected") }
        for name in ["Chroma Console Bootloader","Chroma Console DFU","Chroma Console Firmware","Chroma Console Update","Other pedal"] { check(!Safety.normalDevice(name:name,manufacturer:"Hologram"),"Unsafe endpoint rejected") }
        check(Safety.normalDevice(name:"HOLOGRAM Chroma Console MIDI",manufacturer:"Hologram"),"Normal endpoint accepted")
        check(MIDIInputDecoder.decode([0x30100000,0x20b04063,0x20b04040,0x10f80000,0x20c04f00,0x20b07800]) == [[176,64,64],[248],[192,79]],"UMP decoding skips SysEx and unsupported controls")
        check(MIDIInputDecoder.decode([0x20b04080,0x20c05000,0x40b04000]) == [],"Malformed UMP ignored")
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("ChromaStoreTests-"+UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:folder) }
        let store = try PresetStore(directory:folder)
        let empty = "{\"format\":\"chroma-console-editor\",\"version\":1,\"presets\":[]}"
        let full = "{\"format\":\"chroma-console-editor\",\"version\":1,\"presets\":[{\"name\":\"Test\",\"baseProgram\":79,\"values\":{\"16\":44,\"64\":66},\"notes\":\"\"}]}"
        try store.saveLibrary(empty);try store.saveLibrary(full)
        check(try store.read("library") == full,"Library round trip")
        check(try String(contentsOf:folder.appendingPathComponent("library.previous.json"),encoding:.utf8) == empty,"Backup retained")
        let unsafe = full.replacingOccurrences(of:"\"64\":66",with:"\"95\":127")
        check(rejects { try store.saveLibrary(unsafe) },"Unsafe imported preset rejected")
        check(try store.read("library") == full,"Invalid save leaves existing file unchanged")
        let session = "{\"format\":\"chroma-session\",\"version\":1,\"draft\":{\"name\":\"\",\"notes\":\"\",\"baseProgram\":null,\"values\":{\"70\":117}},\"channel\":1,\"bank\":0,\"page\":\"editor\",\"moduleBypass\":false}"
        try store.saveSession(session);try store.flush()
        check(try store.read("session") == session,"Session round trip")
        check(rejects { try Safety.session(session.replacingOccurrences(of:"\"channel\":1",with:"\"channel\":true")) },"Boolean channel rejected")
        print("\(passed) native checks passed; exhaustive CC/PC combinations covered. No MIDI device access.")
    }
}
