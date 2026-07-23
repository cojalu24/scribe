import CoreML
import Foundation

// MLX-free style-vector loading for the CoreML backend.
//
// The upstream implementation routed voice loading through MLX, whose Metal
// initialization crashes in environments without a GPU device (notably the
// iOS simulator). Voice packs are just little-endian float32 .npy files of
// shape [N, 1, 256] or [N, 256]; parsing them takes no tensor library.
public struct CoreMLVoiceAdapter {
    private static var cache: [String: (rows: Int, cols: Int, data: [Float])] = [:]
    private static let lock = NSLock()

    public static func styleVector(
        from voiceLoader: VoiceLoader,
        voice: String,
        phonemeCount: Int
    ) throws -> MLMultiArray {
        let pack = try loadPack(named: voice, from: voiceLoader.voiceDirectory)
        let row = max(0, min(phonemeCount - 1, pack.rows - 1))
        let start = row * pack.cols

        let array = try MLMultiArray(
            shape: [1, NSNumber(value: pack.cols)],
            dataType: .float32
        )
        let pointer = UnsafeMutableRawPointer(array.dataPointer)
            .bindMemory(to: Float.self, capacity: pack.cols)
        for i in 0..<pack.cols {
            pointer[i] = pack.data[start + i]
        }
        return array
    }

    private static func loadPack(named voice: String, from directory: URL) throws
        -> (rows: Int, cols: Int, data: [Float])
    {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[voice] { return cached }

        let url = directory.appendingPathComponent("\(voice).npy", isDirectory: false)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw KokoroError.missingVoice(voice)
        }
        let parsed = try NPYFile.parseFloat32(Data(contentsOf: url))

        // Accept [N, 256] or [N, 1, 256].
        let dims = parsed.shape
        let rows: Int
        let cols: Int
        switch dims.count {
        case 2:
            rows = dims[0]; cols = dims[1]
        case 3 where dims[1] == 1:
            rows = dims[0]; cols = dims[2]
        default:
            throw KokoroError.expected2DVoicePack(voice, dims)
        }
        let result = (rows, cols, parsed.values)
        cache[voice] = result
        return result
    }
}

// Minimal NPY (NumPy array file) reader: v1/v2 headers, little-endian
// float32 ("<f4"), C-order. Exactly what Kokoro voice packs use.
enum NPYFile {
    struct ParseError: Error { let message: String }

    static func parseFloat32(_ data: Data) throws -> (shape: [Int], values: [Float]) {
        let magic: [UInt8] = [0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59] // \x93NUMPY
        guard data.count > 10, Array(data.prefix(6)) == magic else {
            throw ParseError(message: "not an .npy file")
        }
        let major = data[6]
        let headerLength: Int
        let headerStart: Int
        if major == 1 {
            headerLength = Int(data[8]) | (Int(data[9]) << 8)
            headerStart = 10
        } else {
            headerLength = Int(data[8]) | (Int(data[9]) << 8)
                | (Int(data[10]) << 16) | (Int(data[11]) << 24)
            headerStart = 12
        }
        guard let header = String(
            data: data.subdata(in: headerStart..<(headerStart + headerLength)),
            encoding: .ascii
        ) else {
            throw ParseError(message: "unreadable header")
        }
        guard header.contains("<f4") else {
            throw ParseError(message: "expected little-endian float32, got: \(header)")
        }
        guard !header.contains("'fortran_order': True") else {
            throw ParseError(message: "fortran-order arrays unsupported")
        }
        guard let shapeRange = header.range(of: #"\(([^)]*)\)"#, options: .regularExpression) else {
            throw ParseError(message: "no shape in header")
        }
        let shape = header[shapeRange]
            .dropFirst().dropLast()
            .split(separator: ",")
            .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        let count = shape.reduce(1, *)

        let payload = data.subdata(in: (headerStart + headerLength)..<data.count)
        guard payload.count >= count * 4 else {
            throw ParseError(message: "truncated data")
        }
        var values = [Float](repeating: 0, count: count)
        _ = values.withUnsafeMutableBytes { dest in
            payload.copyBytes(to: dest, count: count * 4)
        }
        return (shape, values)
    }
}
