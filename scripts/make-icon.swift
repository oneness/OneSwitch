#!/usr/bin/env swift
// Draws the OneSwitch app icon: a toggle switch in the ON position on a blue squircle —
// a literal "switch" that puns on the app's name. A raised white vertical track with a blue
// knob pushed to the top (on). Renders every size into AppIcon.iconset/ for `iconutil -c icns`.
import AppKit

let REF: CGFloat = 1024   // design canvas; all coordinates below are in this space (y-up)

func color(_ r: Int, _ g: Int, _ b: Int, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: a)
}
func rrect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> NSBezierPath {
    NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h), xRadius: r, yRadius: r)
}
func withShadow(_ alpha: CGFloat, blur: CGFloat, dy: CGFloat, _ body: () -> Void) {
    NSGraphicsContext.current?.saveGraphicsState()
    let s = NSShadow()
    s.shadowColor = NSColor.black.withAlphaComponent(alpha)
    s.shadowBlurRadius = blur
    s.shadowOffset = NSSize(width: 0, height: dy)
    s.set()
    body()
    NSGraphicsContext.current?.restoreGraphicsState()
}

// Toggle geometry: a vertical track, knob inset and pushed to the top (ON).
let TW: CGFloat = 240, TH: CGFloat = 540
let TX = (REF - TW)/2, TY = (REF - TH)/2
let INSET: CGFloat = 26
let KD = TW - INSET*2
let KX = TX + INSET
let KY = TY + TH - INSET - KD
func knobRect() -> NSRect { NSRect(x: KX, y: KY, width: KD, height: KD) }

// A clean geometric numeral "1" centered at (cx,cy) with total height h.
func draw1(fill: NSColor, cx: CGFloat, cy: CGFloat, h: CGFloat) {
    fill.setFill()
    let stemW = h*0.26
    let top = cy + h/2, bottom = cy - h/2
    rrect(cx - stemW/2, bottom, stemW, h, stemW*0.34).fill()      // stem
    let footW = h*0.62, footH = h*0.16
    rrect(cx - footW/2, bottom, footW, footH, footH*0.4).fill()   // foot
    let flag = NSBezierPath()                                      // upper-left flag
    flag.move(to: NSPoint(x: cx - stemW/2, y: top))
    flag.line(to: NSPoint(x: cx - stemW/2 - h*0.22, y: top - h*0.14))
    flag.line(to: NSPoint(x: cx - stemW/2, y: top - h*0.30))
    flag.close(); flag.fill()
}

func drawDesign() {
    // Background squircle with a vertical blue gradient and a soft top glow.
    let bg = rrect(96, 96, 832, 832, 188)
    NSGradient(starting: color(120, 160, 255), ending: color(44, 88, 228))?.draw(in: bg, angle: -90)
    NSGraphicsContext.current?.saveGraphicsState()
    bg.addClip()
    NSGradient(colors: [color(255, 255, 255, 0.22), color(255, 255, 255, 0)])!
        .draw(fromCenter: NSPoint(x: 512, y: 928), radius: 0,
              toCenter: NSPoint(x: 512, y: 928), radius: 560, options: [])
    NSGraphicsContext.current?.restoreGraphicsState()

    // Raised white track.
    withShadow(0.22, blur: 26, dy: -14) {
        NSGradient(starting: color(255, 255, 255), ending: color(224, 230, 243))?
            .draw(in: rrect(TX, TY, TW, TH, TW/2), angle: -90)
    }

    // Blue knob (ON) with a top-left highlight so it reads as 3D.
    withShadow(0.30, blur: 18, dy: -10) {
        NSGradient(starting: color(98, 140, 246), ending: color(48, 92, 224))?
            .draw(in: NSBezierPath(ovalIn: knobRect()), angle: -90)
    }
    NSGraphicsContext.current?.saveGraphicsState()
    NSBezierPath(ovalIn: knobRect()).addClip()
    NSGradient(colors: [color(255, 255, 255, 0.4), color(255, 255, 255, 0)])!
        .draw(fromCenter: NSPoint(x: KX + KD*0.32, y: KY + KD*0.7), radius: 0,
              toCenter: NSPoint(x: KX + KD*0.32, y: KY + KD*0.7), radius: KD*0.7, options: [])
    NSGraphicsContext.current?.restoreGraphicsState()

    // White "1" on the knob — the "One" in OneSwitch.
    draw1(fill: color(255, 255, 255), cx: KX + KD/2, cy: KY + KD/2, h: KD*0.52)
}

func renderPNG(pixels: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: pixels, height: pixels)
    NSGraphicsContext.saveGraphicsState()
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = ctx
    let scale = CGFloat(pixels) / REF
    ctx.cgContext.scaleBy(x: scale, y: scale)
    drawDesign()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

// (filename, pixel size) per Apple's iconset spec.
let specs: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
for (name, px) in specs {
    let data = renderPNG(pixels: px)
    try! data.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
}
// Master preview at 512 for quick inspection.
try! renderPNG(pixels: 512).write(to: URL(fileURLWithPath: "\(outDir)/../icon-preview.png"))
print("Wrote \(specs.count) PNGs to \(outDir)")
