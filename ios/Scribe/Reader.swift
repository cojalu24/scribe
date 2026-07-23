import Foundation
import AVFoundation

// Reads the paper chunk by chunk with the Kokoro voice, driving the highlight
// as it goes. Sentences are generated on-device just ahead of playback
// (prefetch), and every async step is epoch-guarded so a tap can never be
// hijacked by a stale generation — the same design as the Mac app.
@MainActor
final class Reader: ObservableObject {
    @Published private(set) var currentIndex = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published var loadError: String?

    var voice: String = "af_heart" {
        didSet { if voice != oldValue { cache.removeAll() } }
    }
    var speed: Float = 1.1 {
        didSet { if speed != oldValue { cache.removeAll() } }
    }

    private let engine = KokoroEngine()
    private var chunks: [Chunk] = []
    private var cache: [Int: [Float]] = [:]
    private var generating = Set<Int>()
    // Bumped on every play/pause/seek; stale async work checks and bails.
    private var epoch = 0

    private let audioEngine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!

    init() {
        audioEngine.attach(playerNode)
        audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: format)
    }

    func load(chunks: [Chunk]) {
        stopPlayback()
        self.chunks = chunks
        currentIndex = 0
        cache.removeAll()
        generating.removeAll()
        // Warm the model and the first sentences so Read aloud starts fast.
        prefetch(around: 0)
    }

    func toggle() {
        isPlaying ? pause() : play()
    }

    func play() {
        guard !chunks.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        try? audioEngine.start()
        isPlaying = true
        speak(currentIndex)
    }

    func pause() {
        epoch += 1
        playerNode.stop()
        isPlaying = false
        isBuffering = false
    }

    func stopPlayback() {
        epoch += 1
        playerNode.stop()
        audioEngine.stop()
        isPlaying = false
        isBuffering = false
    }

    func seek(to index: Int) {
        let wasPlaying = isPlaying
        epoch += 1
        playerNode.stop()
        currentIndex = max(0, min(index, chunks.count - 1))
        prefetch(around: currentIndex)
        if wasPlaying {
            speak(currentIndex)
        }
    }

    func step(_ delta: Int) {
        seek(to: currentIndex + delta)
    }

    private func speak(_ index: Int) {
        guard index < chunks.count else {
            isPlaying = false
            return
        }
        currentIndex = index
        let myEpoch = epoch

        Task { [weak self] in
            guard let self else { return }
            do {
                let samples = try await self.samples(for: index)
                guard self.epoch == myEpoch, self.isPlaying else { return }
                self.isBuffering = false
                self.schedule(samples: samples) { [weak self] in
                    guard let self, self.epoch == myEpoch, self.isPlaying else { return }
                    self.speak(index + 1)
                }
                self.prefetch(around: index + 1)
            } catch {
                guard self.epoch == myEpoch else { return }
                self.isPlaying = false
                self.isBuffering = false
                self.loadError = "The voice engine hit a problem: \(error.localizedDescription)"
            }
        }
        if cache[index] == nil {
            isBuffering = true
        }
    }

    private func samples(for index: Int) async throws -> [Float] {
        if let hit = cache[index] { return hit }
        let text = chunks[index].text
        let samples = try await engine.generate(text: text, voice: voice, speed: speed)
        cache[index] = samples
        boundCache(around: index)
        return samples
    }

    // Generate upcoming sentences in the background so playback never gaps.
    private func prefetch(around index: Int) {
        for i in index..<min(index + 3, chunks.count) {
            guard cache[i] == nil, !generating.contains(i) else { continue }
            generating.insert(i)
            Task { [weak self] in
                guard let self else { return }
                let text = self.chunks[i].text
                let voice = self.voice
                let speed = self.speed
                if let samples = try? await self.engine.generate(text: text, voice: voice, speed: speed) {
                    // Voice/speed may have changed while generating.
                    if self.voice == voice, self.speed == speed {
                        self.cache[i] = samples
                    }
                }
                self.generating.remove(i)
            }
        }
    }

    // Keep memory bounded: drop audio far from the listening position.
    private func boundCache(around index: Int) {
        for key in cache.keys where key < index - 5 || key > index + 20 {
            cache.removeValue(forKey: key)
        }
    }

    private func schedule(samples: [Float], completion: @escaping () -> Void) {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: AVAudioFrameCount(samples.count)) else {
            completion()
            return
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { src in
            buffer.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
        }
        playerNode.scheduleBuffer(buffer, at: nil) {
            DispatchQueue.main.async(execute: completion)
        }
        if !playerNode.isPlaying {
            playerNode.play()
        }
    }
}
