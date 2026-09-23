import Foundation
import CoreMIDI

@main struct TransportTests {
    static func main() throws {
        var client: MIDIClientRef = 0, destination: MIDIEndpointRef = 0
        let lock = NSLock(); var received: [[UInt8]] = []
        precondition(MIDIClientCreate("Chroma Local Transport Test" as CFString,nil,nil,&client) == noErr)
        defer { if destination != 0 { MIDIEndpointDispose(destination) }; MIDIClientDispose(client) }
        precondition(MIDIDestinationCreateWithProtocol(client,"Chroma Console Test Receiver" as CFString,._1_0,&destination) { list,_ in
            var packet = UnsafeRawPointer(list).advanced(by:MemoryLayout<MIDIEventList>.offset(of:\.packet)!).assumingMemoryBound(to:MIDIEventPacket.self)
            for _ in 0..<list.pointee.numPackets {
                let pointer = UnsafeRawPointer(packet).advanced(by:MemoryLayout<MIDIEventPacket>.offset(of:\.words)!).assumingMemoryBound(to:UInt32.self)
                let decoded = MIDIInputDecoder.decode(Array(UnsafeBufferPointer(start:pointer,count:Int(packet.pointee.wordCount))))
                lock.lock();received.append(contentsOf:decoded);lock.unlock()
                packet = UnsafePointer(MIDIEventPacketNext(packet))
            }
        } == noErr)
        let midi = MIDIService()
        let inventory = try midi.ports()
        let ports = inventory["ports"] as! [[String:Any]]
        // Never choose the physical pedal. The endpoint must be the virtual receiver
        // this test just created, verified by its exact unique identifier.
        var unique:Int32 = 0;MIDIObjectGetIntegerProperty(destination,kMIDIPropertyUniqueID,&unique)
        let id = "output-\(unique)"
        precondition(ports.contains { $0["id"] as? String == id })
        let base:[String:Any] = ["id":id,"generation":midi.generation,"channel":1]
        func command(_ fields:[String:Any]) -> [String:Any] { base.merging(fields,uniquingKeysWith:{$1}) }
        try midi.send(command(["op":"cc","cc":64,"value":66]))
        try midi.send(command(["op":"cc","cc":16,"value":44]))
        try midi.send(command(["op":"program","program":79]))
        RunLoop.main.run(until:Date(timeIntervalSinceNow:0.3))
        lock.lock();let actual=received;lock.unlock()
        precondition(actual == [[176,64,66],[176,16,44],[192,79]],"CoreMIDI packet delivery mismatch")
        func rejected(_ request:[String:Any]) -> Bool { do { try midi.send(request);return false } catch { return true } }
        precondition(rejected(command(["op":"cc","cc":120,"value":0])))
        precondition(rejected(command(["op":"raw","data":[240,0,247]])))
        midi.setSuspended(true)
        precondition(rejected(command(["op":"cc","cc":64,"value":0])))
        midi.setSuspended(false)
        precondition(rejected(command(["op":"cc","cc":64,"value":0])),"Stale session must not replay after wake")
        MIDIEndpointDispose(destination);destination=0;midi.refreshAndNotify()
        precondition(rejected(["op":"cc","id":id,"generation":midi.generation,"channel":1,"cc":64,"value":0]))
        precondition(midi.sent == 3)
        print("Native CoreMIDI loopback passed: three exact messages to the test-only endpoint; invalid, stale, suspended and disconnected sends blocked. No physical-pedal sends.")
    }
}
