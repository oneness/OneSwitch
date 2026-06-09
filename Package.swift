// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "OneSwitch",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "OneSwitch",
            path: "Sources/OneSwitch"
        )
    ]
)
