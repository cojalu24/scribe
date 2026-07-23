import Foundation
import Kokoro

// The real voice: Kokoro-82M running on-device via CoreML (Neural Engine on
// iPhone). Same voices as Scribe on the Mac. Wraps the vendored pipeline in
// an actor so generation runs off the main thread, one request at a time.
actor KokoroEngine {
    enum EngineError: Error {
        case assetsMissing
    }

    static let voices: [(id: String, label: String)] = [
        ("af_heart", "Heart (US, warm)"),
        ("af_bella", "Bella (US)"),
        ("am_michael", "Michael (US, male)"),
        ("bf_emma", "Emma (UK)"),
        ("bm_george", "George (UK, male)"),
    ]

    private var pipeline: KPipeline?

    func load() throws {
        guard pipeline == nil else { return }
        guard let assets = Bundle.main.url(forResource: "KokoroAssets", withExtension: nil) else {
            throw EngineError.assetsMissing
        }
        let model = try SegmentedCoreMLModel(
            segmentedDir: assets,
            configURL: assets.appendingPathComponent("config.json")
        )
        let voiceLoader = VoiceLoader(
            baseDirectory: assets.appendingPathComponent("voices"),
            enableDownload: false
        )
        pipeline = KPipeline(coreMLSegmentedModel: model, voices: voiceLoader)
    }

    // Generates 24 kHz mono samples for one sentence.
    func generate(text: String, voice: String, speed: Float) throws -> [Float] {
        try load()
        guard let pipeline else { throw EngineError.assetsMissing }
        let result = try pipeline.synthesize(text: text, voice: voice, speed: speed)
        return result.audio
    }
}
