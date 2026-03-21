const { execSync } = require('child_process');

// 测试Swift代码
const swiftCode = `
import Foundation

struct ServerMessage: Codable {
    let type: String
    let errorMessage: String?
    let text: String?
    let isFinal: Bool?
    let audioPath: String?
    let status: StatusInfo?

    struct StatusInfo: Codable {
        let isRecording: Bool
        let duration: Double
        let memoryUsage: UInt64
    }

    static func error(_ message: String) -> ServerMessage {
        ServerMessage(type: "error", errorMessage: message, text: nil, isFinal: nil, audioPath: nil, status: nil)
    }
}

let message = ServerMessage.error("Invalid message format")
let encoder = JSONEncoder()
if let data = try? encoder.encode(message) {
    print("Encoded bytes: \\(data.map { String(format: "%02X", $0) }.joined(separator: " "))")
    print("Length: \\(data.count)")

    if let str = String(data: data, encoding: .utf8) {
        print("As string: \\(str)")
    }
}
`;

try {
  const result = execSync(`swift -e '${swiftCode}'`, { encoding: 'utf8' });
  console.log(result);
} catch (error) {
  console.error(error);
}
