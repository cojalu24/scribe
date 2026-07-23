import SwiftUI

// Scribe's brand, matching the Mac app: International Klein Blue accent,
// Space Grotesk type, minimal black-on-white.
enum Theme {
    static let klein = Color(red: 0 / 255, green: 47 / 255, blue: 167 / 255)
    static let kleinSoft = Color(red: 234 / 255, green: 239 / 255, blue: 255 / 255)
    static let foreground = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
    static let muted = Color(red: 107 / 255, green: 107 / 255, blue: 107 / 255)
    static let rule = Color(red: 230 / 255, green: 230 / 255, blue: 230 / 255)
    static let backdrop = Color(red: 244 / 255, green: 244 / 255, blue: 244 / 255)
    static let recording = Color(red: 198 / 255, green: 40 / 255, blue: 40 / 255)
    static let highlightPlaying = Color(red: 1.0, green: 213 / 255, blue: 79 / 255)

    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        Font.custom("Space Grotesk", size: size).weight(weight)
    }
}
