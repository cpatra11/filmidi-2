import Foundation
import AVFoundation
@preconcurrency import Speech
import Accelerate
import ImageIO
import UniformTypeIdentifiers

typealias JSONObject = [String: Any]

final class ResumeOnceBox<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, Error>?
  private var finished = false

  init(_ continuation: CheckedContinuation<T, Error>) {
    self.continuation = continuation
  }

  func resume(returning value: T) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished, let continuation else { return }
    finished = true
    self.continuation = nil
    continuation.resume(returning: value)
  }

  func resume(throwing error: Error) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished, let continuation else { return }
    finished = true
    self.continuation = nil
    continuation.resume(throwing: error)
  }
}

func log(_ message: String) {
  FileHandle.standardError.write((message + "\n").data(using: .utf8) ?? Data())
}

func jsonLine(_ object: JSONObject) {
  guard JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object, options: []),
        let line = String(data: data, encoding: .utf8) else {
    return
  }
  print(line)
  fflush(stdout)
}

func resolveSourceURL(_ raw: String) async throws -> URL {
  if raw.hasPrefix("file://"), let url = URL(string: raw) {
    return url
  }
  if raw.hasPrefix("/"), FileManager.default.fileExists(atPath: raw) {
    return URL(fileURLWithPath: raw)
  }
  if let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
    let (data, response) = try await URLSession.shared.data(from: url)
    if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
      throw NSError(domain: "FilmidiSidecar", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Failed to download source (\(http.statusCode))"])
    }
    let ext = url.pathExtension.isEmpty ? "bin" : url.pathExtension
    let temp = FileManager.default.temporaryDirectory.appendingPathComponent("filmidi-sidecar-\(UUID().uuidString).\(ext)")
    try data.write(to: temp, options: .atomic)
    return temp
  }
  throw NSError(domain: "FilmidiSidecar", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported source URL: \(raw)"])
}

func cmTime(from seconds: Double) -> CMTime {
  CMTime(seconds: seconds, preferredTimescale: 600)
}

func seconds(from time: CMTime) -> Double {
  CMTimeGetSeconds(time)
}

func fileType(forExt ext: String) -> AVFileType? {
  switch ext.lowercased() {
  case "mp4", "m4v":
    return .mp4
  case "mov":
    return .mov
  case "m4a":
    return .m4a
  default:
    return nil
  }
}

func outputExtension(forFileType fileType: AVFileType) -> String {
  switch fileType {
  case .mp4:
    return "mp4"
  case .mov:
    return "mov"
  case .m4a:
    return "m4a"
  default:
    return "mov"
  }
}

func encodeCGImageToDataURL(_ image: CGImage, quality: Double) -> String? {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
    return nil
  }
  let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: max(0, min(1, quality))]
  CGImageDestinationAddImage(destination, image, options as CFDictionary)
  guard CGImageDestinationFinalize(destination) else {
    return nil
  }
  return "data:image/jpeg;base64,\((data as Data).base64EncodedString())"
}

func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
  await withCheckedContinuation { continuation in
    SFSpeechRecognizer.requestAuthorization { status in
      continuation.resume(returning: status)
    }
  }
}

func buildTranscriptResponse(text: String, segments: [JSONObject], durationMs: Double) -> JSONObject {
  return [
    "text": text,
    "transcripts": [
      [
        "text": text,
        "start_time": 0,
        "end_time": durationMs,
        "segments": segments,
        "words": segments,
      ]
    ]
  ]
}

func recognizeSpeechFile(sourceURL: URL, localeId: String, timeoutSeconds: Double = 300) async throws -> Data {
  guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
    throw NSError(domain: "FilmidiSidecar", code: 4, userInfo: [NSLocalizedDescriptionKey: "Unsupported speech locale: \(localeId)"])
  }

  let request = SFSpeechURLRecognitionRequest(url: sourceURL)
  request.shouldReportPartialResults = false
  request.requiresOnDeviceRecognition = false

  return try await withCheckedThrowingContinuation { continuation in
    let box = ResumeOnceBox<Data>(continuation)

    let task = recognizer.recognitionTask(with: request) { result, error in
      if let error {
        box.resume(throwing: error)
        return
      }
      guard let result, result.isFinal else { return }

      let transcriptText = result.bestTranscription.formattedString
      let segmentObjects: [JSONObject] = result.bestTranscription.segments.map { segment in
        let startMs = segment.timestamp * 1000
        let endMs = (segment.timestamp + segment.duration) * 1000
        return [
          "text": segment.substring,
          "begin_time": startMs,
          "start_time": startMs,
          "end_time": endMs,
        ]
      }

      let durationMs = segmentObjects.last?["end_time"] as? Double ?? 0
      let response = buildTranscriptResponse(text: transcriptText, segments: segmentObjects, durationMs: durationMs)
      guard let data = try? JSONSerialization.data(withJSONObject: response, options: []) else {
        box.resume(throwing: NSError(domain: "FilmidiSidecar", code: 13, userInfo: [NSLocalizedDescriptionKey: "Failed to encode transcript response"]))
        return
      }
      box.resume(returning: data)
    }

    DispatchQueue.global().asyncAfter(deadline: .now() + timeoutSeconds) {
      task.cancel()
      box.resume(throwing: NSError(domain: "FilmidiSidecar", code: 5, userInfo: [NSLocalizedDescriptionKey: "Speech transcription timed out"]))
    }
  }
}

func transcribeAudio(_ payload: JSONObject) async throws -> JSONObject {
  let rawUrl = payload["audioUrl"] as? String ?? payload["url"] as? String
  guard let rawUrl else {
    throw NSError(domain: "FilmidiSidecar", code: 2, userInfo: [NSLocalizedDescriptionKey: "audioUrl is required"])
  }

  let auth = await requestSpeechAuthorization()
  guard auth == .authorized else {
    throw NSError(domain: "FilmidiSidecar", code: 3, userInfo: [NSLocalizedDescriptionKey: "Speech recognition is not authorized (\(auth.rawValue))"])
  }

  let sourceURL = try await resolveSourceURL(rawUrl)
  let language = (payload["options"] as? JSONObject)?["language"] as? String
  let localeId = language ?? "en-US"
  let data = try await recognizeSpeechFile(sourceURL: sourceURL, localeId: localeId)
  guard let json = try? JSONSerialization.jsonObject(with: data, options: []),
        let response = json as? JSONObject else {
    throw NSError(domain: "FilmidiSidecar", code: 14, userInfo: [NSLocalizedDescriptionKey: "Failed to decode transcript response"])
  }
  return response
}

func detectBeats(_ payload: JSONObject) async throws -> JSONObject {
  let rawUrl = payload["url"] as? String ?? payload["audioUrl"] as? String
  guard let rawUrl else {
    throw NSError(domain: "FilmidiSidecar", code: 6, userInfo: [NSLocalizedDescriptionKey: "url is required"])
  }

  let sourceURL = try await resolveSourceURL(rawUrl)
  let startSeconds = payload["startSeconds"] as? Double
  let endSeconds = payload["endSeconds"] as? Double

  let file = try AVAudioFile(forReading: sourceURL)
  let processingFormat = file.processingFormat
  let sampleRate = processingFormat.sampleRate
  let channels = Int(processingFormat.channelCount)
  let chunkSize: AVAudioFrameCount = 4096

  guard let buffer = AVAudioPCMBuffer(pcmFormat: processingFormat, frameCapacity: chunkSize) else {
    throw NSError(domain: "FilmidiSidecar", code: 7, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate audio buffer"])
  }

  var samples: [Float] = []
  while file.framePosition < file.length {
    let framesLeft = AVAudioFrameCount(file.length - file.framePosition)
    let framesToRead = min(chunkSize, framesLeft)
    try file.read(into: buffer, frameCount: framesToRead)
    guard let channelData = buffer.floatChannelData else { continue }
    let frameLength = Int(buffer.frameLength)
    for frame in 0..<frameLength {
      var sum: Float = 0
      for channel in 0..<channels {
        sum += channelData[channel][frame]
      }
      samples.append(sum / Float(max(1, channels)))
    }
  }

  let startIndex = startSeconds.map { max(0, Int($0 * sampleRate)) } ?? 0
  let endIndex = endSeconds.map { min(samples.count, Int($0 * sampleRate)) } ?? samples.count
  let trimmed = startIndex < endIndex ? Array(samples[startIndex..<endIndex]) : []

  let hopSeconds = 0.01
  let hopSize = max(1, Int(sampleRate * hopSeconds))
  let numHops = max(0, trimmed.count / hopSize)
  var envelope = [Float](repeating: 0, count: numHops)

  for i in 0..<numHops {
    let start = i * hopSize
    let end = min(trimmed.count, start + hopSize)
    guard end > start else { continue }
    var sumSquares: Float = 0
    for j in start..<end {
      sumSquares += trimmed[j] * trimmed[j]
    }
    envelope[i] = sqrt(sumSquares / Float(end - start))
  }

  var derivative = [Float](repeating: 0, count: envelope.count)
  if envelope.count > 1 {
    for i in 1..<envelope.count {
      derivative[i] = envelope[i] - envelope[i - 1]
    }
  }

  let windowSize = max(1, Int(0.5 / hopSeconds))
  let minHopsBetween = max(1, Int(0.2 / hopSeconds))
  let onsetThreshold: Float = 0.3
  var beats: [Double] = []
  var lastBeatHop = -minHopsBetween

  if envelope.count > windowSize + 1 {
    for i in windowSize..<(envelope.count - 1) {
      let localSlice = envelope[(i - windowSize)..<i]
      let localMean = localSlice.reduce(0, +) / Float(windowSize)
      let energyIncrease = derivative[i]
      let relativeIncrease = localMean > 0 ? energyIncrease / localMean : 0
      if energyIncrease > 0,
         relativeIncrease > onsetThreshold,
         envelope[i] > localMean * 0.5,
         (i - lastBeatHop) >= minHopsBetween {
        let beatTime = Double(i) * hopSeconds + (startSeconds ?? 0)
        beats.append(beatTime)
        lastBeatHop = i
      }
    }
  }

  let intervals = zip(beats.dropFirst(), beats).map { $0.0 - $0.1 }
  let bpm: Double
  if let medianInterval = intervals.sorted().dropFirst(intervals.count / 2).first, medianInterval > 0 {
    let estimate = 60.0 / medianInterval
    bpm = (30...300).contains(Int(estimate)) ? (estimate * 10).rounded() / 10 : 0
  } else {
    bpm = 0
  }

  return [
    "bpm": bpm,
    "beats": beats.map { ($0 * 1000).rounded() / 1000 },
    "downbeats": beats.enumerated().filter { $0.offset % 4 == 0 }.map { ($0.element * 1000).rounded() / 1000 },
  ]
}

func extractAudio(_ payload: JSONObject) async throws -> JSONObject {
  let rawUrl = payload["sourceUrl"] as? String ?? payload["url"] as? String
  guard let rawUrl else {
    throw NSError(domain: "FilmidiSidecar", code: 8, userInfo: [NSLocalizedDescriptionKey: "sourceUrl is required"])
  }

  let sourceURL = try await resolveSourceURL(rawUrl)
  let asset = AVURLAsset(url: sourceURL)
  guard asset.tracks(withMediaType: .audio).isEmpty == false else {
    throw NSError(domain: "FilmidiSidecar", code: 9, userInfo: [NSLocalizedDescriptionKey: "No audio track found"])
  }

  let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent("filmidi-extract-\(UUID().uuidString).m4a")
  guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
    throw NSError(domain: "FilmidiSidecar", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to create export session"])
  }
  try await export.export(to: outputURL, as: .m4a)

  return [
    "audioUrl": outputURL.absoluteString,
    "outputUrl": outputURL.absoluteString,
  ]
}

func sampleFrames(_ payload: JSONObject) async throws -> JSONObject {
  let rawUrl = payload["url"] as? String ?? payload["sourceUrl"] as? String ?? payload["mediaUrl"] as? String
  guard let rawUrl else {
    throw NSError(domain: "FilmidiSidecar", code: 15, userInfo: [NSLocalizedDescriptionKey: "url is required"])
  }

  let sourceURL = try await resolveSourceURL(rawUrl)
  let asset = AVURLAsset(url: sourceURL)
  let durationSeconds = seconds(from: asset.duration)
  guard durationSeconds.isFinite, durationSeconds > 0 else {
    throw NSError(domain: "FilmidiSidecar", code: 16, userInfo: [NSLocalizedDescriptionKey: "Invalid media duration"])
  }

  let maxFrames = max(1, min((payload["maxFrames"] as? Int) ?? 6, 24))
  let quality = payload["quality"] as? Double ?? 0.7
  let startSeconds = max(0, payload["startSeconds"] as? Double ?? 0)
  let endSeconds = min(durationSeconds, payload["endSeconds"] as? Double ?? durationSeconds)
  let effectiveEnd = max(startSeconds, endSeconds)
  let span = max(0.001, effectiveEnd - startSeconds)

  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.requestedTimeToleranceBefore = .zero
  generator.requestedTimeToleranceAfter = .zero

  var frames: [JSONObject] = []
  for index in 0..<maxFrames {
    let timeSeconds = startSeconds + (span * (Double(index) + 0.5)) / Double(maxFrames)
    let captureSeconds = min(effectiveEnd, timeSeconds)
    let captureTime = cmTime(from: captureSeconds)
    do {
      let image = try generator.copyCGImage(at: captureTime, actualTime: nil)
      let width = image.width
      let height = image.height
      guard let dataUrl = encodeCGImageToDataURL(image, quality: quality) else {
        continue
      }
      frames.append([
        "timestamp": captureSeconds,
        "width": width,
        "height": height,
        "dataUrl": dataUrl,
      ])
    } catch {
      log("[sample-frames] failed at \(captureSeconds)s: \(error.localizedDescription)")
    }
  }

  return [
    "url": sourceURL.absoluteString,
    "duration": durationSeconds,
    "frameCount": frames.count,
    "frameTimestamps": frames.compactMap { $0["timestamp"] as? Double },
    "frames": frames,
  ]
}

func exportVideo(_ payload: JSONObject) async throws -> JSONObject {
  let rawUrl = payload["url"] as? String ?? payload["sourceUrl"] as? String ?? payload["mediaUrl"] as? String
  guard let rawUrl else {
    throw NSError(domain: "FilmidiSidecar", code: 17, userInfo: [NSLocalizedDescriptionKey: "url is required"])
  }

  let sourceURL = try await resolveSourceURL(rawUrl)
  let asset = AVURLAsset(url: sourceURL)
  let durationSeconds = seconds(from: asset.duration)
  guard durationSeconds.isFinite, durationSeconds > 0 else {
    throw NSError(domain: "FilmidiSidecar", code: 18, userInfo: [NSLocalizedDescriptionKey: "Invalid media duration"])
  }

  let startSeconds = max(0, payload["startSeconds"] as? Double ?? 0)
  let endSeconds = min(durationSeconds, payload["endSeconds"] as? Double ?? durationSeconds)
  let outputPreset = payload["preset"] as? String ?? AVAssetExportPresetHighestQuality
  let requestedOutput = payload["outputPath"] as? String ?? payload["outputUrl"] as? String
  let requestedExt = (payload["outputExt"] as? String) ?? (payload["format"] as? String)
  let outputExt = requestedExt?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().isEmpty == false
    ? requestedExt!.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    : "mov"
  let outputURL: URL
  if let requestedOutput, !requestedOutput.isEmpty {
    outputURL = requestedOutput.hasPrefix("file://") ? URL(string: requestedOutput)! : URL(fileURLWithPath: requestedOutput)
  } else {
    outputURL = FileManager.default.temporaryDirectory.appendingPathComponent("filmidi-export-\(UUID().uuidString).\(outputExt)")
  }

  guard let export = AVAssetExportSession(asset: asset, presetName: outputPreset) else {
    throw NSError(domain: "FilmidiSidecar", code: 19, userInfo: [NSLocalizedDescriptionKey: "Failed to create export session"])
  }

  if endSeconds > startSeconds {
    export.timeRange = CMTimeRange(start: cmTime(from: startSeconds), duration: cmTime(from: endSeconds - startSeconds))
  }

  let selectedFileType = requestedExt.flatMap { fileType(forExt: $0) } ?? fileType(forExt: outputExt) ?? .mov
  try await export.export(to: outputURL, as: selectedFileType)

  return [
    "outputUrl": outputURL.absoluteString,
    "fileType": selectedFileType.rawValue,
    "preset": outputPreset,
    "sourceDuration": durationSeconds,
    "trimStartSeconds": startSeconds,
    "trimEndSeconds": endSeconds,
  ]
}

func handleRequest(_ request: JSONObject) async -> JSONObject {
  let requestId = request["requestId"] as? String ?? UUID().uuidString
  let task = (request["task"] as? String) ?? (request["type"] as? String) ?? ""
  let payload = request["payload"] as? JSONObject ?? [:]

  do {
    let result: JSONObject
    switch task {
    case "ping":
      result = [
        "backend": "swift-sidecar",
        "platform": "macOS",
        "version": "1",
      ]
    case "transcribe-audio":
      result = try await transcribeAudio(payload)
    case "detect-beats":
      result = try await detectBeats(payload)
    case "extract-audio":
      result = try await extractAudio(payload)
    case "sample-frames":
      result = try await sampleFrames(payload)
    case "export-video":
      result = try await exportVideo(payload)
    default:
      result = [
        "error": "Unknown task: \(task)",
      ]
    }

    if let error = result["error"] as? String {
      return [
        "type": "response",
        "requestId": requestId,
        "ok": false,
        "backend": "swift-sidecar",
        "error": error,
        "result": result,
      ]
    }

    return [
      "type": "response",
      "requestId": requestId,
      "ok": true,
      "backend": "swift-sidecar",
      "result": result,
    ]
  } catch {
    return [
      "type": "response",
      "requestId": requestId,
      "ok": false,
      "backend": "swift-sidecar",
      "error": error.localizedDescription,
    ]
  }
}

@main
struct FilmidiSidecar {
  static func main() async {
    log("[ready] Filmidi sidecar starting")
    jsonLine([
      "type": "ready",
      "backend": "swift-sidecar",
      "version": "1",
    ])

    while let line = readLine(strippingNewline: true) {
      guard let data = line.data(using: .utf8) else { continue }
      guard let json = try? JSONSerialization.jsonObject(with: data, options: []),
            let request = json as? JSONObject else {
        continue
      }

      let response = await handleRequest(request)
      jsonLine(response)
    }
  }
}
