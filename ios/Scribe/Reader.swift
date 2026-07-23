import Foundation
import AVFoundation
import Kokoro

// Dev-only escape hatch: SIMCTL_CHILD_SCRIBE_VOICE=system swaps Kokoro for
// the instant system synthesizer, so simulator UI iteration doesn't pay the
// ~10-minute CoreML recompile that follows every reinstall. Never set in
// production; the shipped voice is always Kokoro.
private let useSystemVoiceForDev =
    ProcessInfo.processInfo.environment["SCRIBE_VOICE"] == "system"

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

    // Playback: one AVAudioPlayer per sentence, fed standard WAV data — the
    // same strategy as the Mac app. (A hand-rolled AVAudioEngine buffer chain
    // produced audibly garbled output here; keep playback boring.)
    private var player: AVAudioPlayer?
    private var playerDelegate: PlayerDone?
    private lazy var devSynth = SystemVoiceDev(owner: self)

    func load(chunks: [Chunk]) {
        stopPlayback()
        self.chunks = chunks
        currentIndex = 0
        cache.removeAll()
        generating.removeAll()
        // Warm the model and the first sentences so Read aloud starts fast.
        if !useSystemVoiceForDev { prefetch(around: 0) }
    }

    func toggle() {
        isPlaying ? pause() : play()
    }

    func play() {
        guard !chunks.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        isPlaying = true
        speak(currentIndex)
    }

    func pause() {
        epoch += 1
        player?.stop()
        player = nil
        if useSystemVoiceForDev { devSynth.stop() }
        isPlaying = false
        isBuffering = false
    }

    func stopPlayback() {
        pause()
    }

    func seek(to index: Int) {
        let wasPlaying = isPlaying
        epoch += 1
        player?.stop()
        player = nil
        if useSystemVoiceForDev { devSynth.stop() }
        currentIndex = max(0, min(index, chunks.count - 1))
        if !useSystemVoiceForDev { prefetch(around: currentIndex) }
        if wasPlaying {
            isPlaying = true
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

        if useSystemVoiceForDev {
            devSynth.speak(chunks[index].text, epoch: myEpoch) { [weak self] in
                guard let self, self.epoch == myEpoch, self.isPlaying else { return }
                self.speak(index + 1)
            }
            return
        }

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
        dumpIfRequested(samples, index: index)
        return samples
    }

    // Diagnostic: SIMCTL_CHILD_SCRIBE_DUMP=1 writes each generated chunk as a
    // WAV into Documents, so host-side tooling can compare the simulator's
    // output against a known-good reference.
    private func dumpIfRequested(_ samples: [Float], index: Int) {
        guard ProcessInfo.processInfo.environment["SCRIBE_DUMP"] == "1" else { return }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = docs.appendingPathComponent("chunk\(index).wav")
        var data = Data()
        let sr: UInt32 = 24_000
        let byteCount = UInt32(samples.count * 2)
        func le32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func le16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        data.append("RIFF".data(using: .ascii)!); le32(36 + byteCount)
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!); le32(16); le16(1); le16(1)
        le32(sr); le32(sr * 2); le16(2); le16(16)
        data.append("data".data(using: .ascii)!); le32(byteCount)
        for s in samples {
            le16(UInt16(bitPattern: Int16(max(-32768, min(32767, Int(s * 32767))))))
        }
        try? data.write(to: url)
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
        let wav = Kokoro.AudioWriter.wavData(samples: samples, sampleRate: 24_000)
        guard let newPlayer = try? AVAudioPlayer(data: wav) else {
            completion()
            return
        }
        let delegate = PlayerDone(onFinish: completion)
        playerDelegate = delegate
        newPlayer.delegate = delegate
        player = newPlayer
        newPlayer.play()
    }
}

// Bridges AVAudioPlayer's finish callback to a closure on the main actor.
private final class PlayerDone: NSObject, AVAudioPlayerDelegate {
    private let onFinish: () -> Void
    init(onFinish: @escaping () -> Void) {
        self.onFinish = onFinish
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let done = onFinish
        Task { @MainActor in done() }
    }
}

// Minimal system-voice driver used only by the dev fallback above.
private final class SystemVoiceDev: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private weak var owner: Reader?
    private var completion: (() -> Void)?

    init(owner: Reader) {
        self.owner = owner
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, epoch: Int, done: @escaping () -> Void) {
        completion = done
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }

    func stop() {
        completion = nil
        synthesizer.stopSpeaking(at: .immediate)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                           didFinish utterance: AVSpeechUtterance) {
        let done = completion
        completion = nil
        Task { @MainActor in done?() }
    }
}
