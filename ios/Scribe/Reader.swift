import Foundation
import AVFoundation

// Reads the paper chunk by chunk, driving the highlight as it goes.
//
// PLACEHOLDER ENGINE: uses the system speech synthesizer so the whole
// reading flow works end to end. The Kokoro engine (same voices as the Mac
// app, via CoreML) replaces the synthesis internals next — the interface is
// designed so nothing else has to change.
@MainActor
final class Reader: NSObject, ObservableObject {
    @Published private(set) var currentIndex = 0
    @Published private(set) var isPlaying = false

    var speed: Double = 1.1

    private var chunks: [Chunk] = []
    private let synthesizer = AVSpeechSynthesizer()
    // Bumped on every play/pause/seek so stale utterance callbacks can't
    // hijack playback — same guard the Mac app needed.
    private var epoch = 0

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func load(chunks: [Chunk]) {
        stop()
        self.chunks = chunks
        currentIndex = 0
    }

    func toggle() {
        isPlaying ? pause() : play()
    }

    func play() {
        guard !chunks.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        speak(currentIndex)
    }

    func pause() {
        epoch += 1
        synthesizer.stopSpeaking(at: .immediate)
        isPlaying = false
    }

    func stop() {
        epoch += 1
        synthesizer.stopSpeaking(at: .immediate)
        isPlaying = false
        currentIndex = 0
    }

    func seek(to index: Int) {
        let wasPlaying = isPlaying
        epoch += 1
        synthesizer.stopSpeaking(at: .immediate)
        currentIndex = max(0, min(index, chunks.count - 1))
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
        isPlaying = true
        let myEpoch = epoch

        let utterance = AVSpeechUtterance(string: chunks[index].text)
        // Map our 1.1x style multiplier onto AVSpeech's 0..1 rate scale.
        utterance.rate = min(1.0, AVSpeechUtteranceDefaultSpeechRate * Float(speed))
        utterance.postUtteranceDelay = 0.05
        onFinish = { [weak self] in
            guard let self, self.epoch == myEpoch, self.isPlaying else { return }
            self.speak(index + 1)
        }
        synthesizer.speak(utterance)
    }

    private var onFinish: (() -> Void)?
}

extension Reader: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                                       didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.onFinish?()
        }
    }
}
