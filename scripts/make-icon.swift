#!/usr/bin/env swift
// Draws the OneSwitch app icon: a rounded keycap on a blue squircle, with the
// Control (chevron) and Tab (arrow-to-bar) glyphs drawn as vectors. Renders every
// size into AppIcon.iconset/ for `iconutil -c icns`.
import AppKit

let REF: CGFloat = 1024   // design canvas; all coordinates below are in this space (y-up)

func color(_ r: Int, _ g: Int, _ b: Int) -> NSColor {
    NSColor(srgbRed: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: 1)
}

func rrect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> NSBezierPath {
    NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h), xRadius: r, yRadius: r)
}

func drawDesign() {
    // Background squircle with a vertical blue gradient.
    let bg = rrect(96, 96, 832, 832, 188)
    NSGradient(starting: color(122, 162, 255), ending: color(47, 91, 230))?.draw(in: bg, angle: -90)

    // Keycap geometry.
    let kx: CGFloat = 250, kw: CGFloat = 524
    let ky: CGFloat = 320, kh: CGFloat = 404
    let radius: CGFloat = 76

    // Soft drop shadow + a darker base so the key reads as 3D.
    NSGraphicsContext.current?.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
    shadow.shadowBlurRadius = 34
    shadow.shadowOffset = NSSize(width: 0, height: -22)
    shadow.set()
    color(176, 192, 222).setFill()              // base lip color
    rrect(kx, ky - 26, kw, kh, radius).fill()
    NSGraphicsContext.current?.restoreGraphicsState()

    // Key top face.
    let face = rrect(kx, ky, kw, kh, radius)
    NSGradient(starting: color(255, 255, 255), ending: color(229, 235, 246))?.draw(in: face, angle: -90)

    // Glyphs.
    let glyph = color(35, 48, 68)
    glyph.setStroke()
    glyph.setFill()
    let lw: CGFloat = 58

    // Control chevron (points up): apex high, two feet down-out.
    let cAt = NSPoint(x: 404, y: 562)
    let chevron = NSBezierPath()
    chevron.lineWidth = lw
    chevron.lineCapStyle = .round
    chevron.lineJoinStyle = .round
    chevron.move(to: NSPoint(x: cAt.x - 86, y: cAt.y - 96))
    chevron.line(to: cAt)
    chevron.line(to: NSPoint(x: cAt.x + 86, y: cAt.y - 96))
    chevron.stroke()

    // Tab glyph: rightward arrow into a vertical bar (the tab stop).
    let cy: CGFloat = 508
    let shaft = NSBezierPath()
    shaft.lineWidth = lw
    shaft.lineCapStyle = .round
    shaft.lineJoinStyle = .round
    shaft.move(to: NSPoint(x: 540, y: cy))
    shaft.line(to: NSPoint(x: 690, y: cy))
    // arrowhead
    shaft.move(to: NSPoint(x: 648, y: cy + 46))
    shaft.line(to: NSPoint(x: 694, y: cy))
    shaft.line(to: NSPoint(x: 648, y: cy - 46))
    shaft.stroke()
    // vertical bar / tab stop
    let bar = NSBezierPath()
    bar.lineWidth = lw
    bar.lineCapStyle = .round
    bar.move(to: NSPoint(x: 742, y: cy + 70))
    bar.line(to: NSPoint(x: 742, y: cy - 70))
    bar.stroke()
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
