// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "FilmidiSidecar",
  platforms: [
    .macOS(.v15),
  ],
  products: [
    .executable(name: "FilmidiSidecar", targets: ["FilmidiSidecar"]),
  ],
  targets: [
    .executableTarget(
      name: "FilmidiSidecar",
      path: "Sources/FilmidiSidecar"
    ),
  ]
)
