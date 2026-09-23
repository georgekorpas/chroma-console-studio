import AppKit
import Foundation
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for (name, pixels) in [("icon_16x16",16),("icon_16x16@2x",32),("icon_32x32",32),("icon_32x32@2x",64),("icon_128x128",128),("icon_128x128@2x",256),("icon_256x256",256),("icon_256x256@2x",512),("icon_512x512",512),("icon_512x512@2x",1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:bitmap)
    let scale = CGFloat(pixels)/1024
    let transform = NSAffineTransform(); transform.scale(by:scale); transform.concat()
    let shape = NSBezierPath(roundedRect:NSRect(x:48,y:48,width:928,height:928),xRadius:212,yRadius:212)
    NSGradient(starting:NSColor(srgbRed:0.18,green:0.21,blue:0.23,alpha:1),ending:NSColor(srgbRed:0.055,green:0.065,blue:0.075,alpha:1))!.draw(in:shape,angle:-70)
    NSColor(white:0.38,alpha:0.4).setStroke(); shape.lineWidth=2; shape.stroke()
    let colours:[NSColor] = [.init(srgbRed:1,green:0.54,blue:0.47,alpha:1),.init(srgbRed:0.96,green:0.81,blue:0.41,alpha:1),.init(srgbRed:0.55,green:0.85,blue:0.55,alpha:1),.init(srgbRed:0.43,green:0.85,blue:0.92,alpha:1)]
    for i in 0..<4 {
        let x = CGFloat(208+i*150), y:CGFloat=265
        let p=NSBezierPath();p.move(to:NSPoint(x:x,y:y));p.line(to:NSPoint(x:x+72,y:y));p.line(to:NSPoint(x:x+132,y:759));p.line(to:NSPoint(x:x+60,y:759));p.close()
        colours[i].setFill();p.fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using:.png,properties:[:])!.write(to:directory.appendingPathComponent(name+".png"))
}
