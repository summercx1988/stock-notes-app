const { execSync } = require('child_process');

// 使用Swift代码测试JSON编码
const swiftCode = `
import Foundation
let message = ["type": "error", "errorMessage": "Invalid message format"] as [String : String?]
let encoder = JSONEncoder()
if let data = try? encoder.encode(message) {
    print("JSON bytes: \\(data.map { String(format: "%02X", $0) }.joined(separator: " "))")
    print("Length: \\(data.count)")
}
`;

try {
  const result = execSync(`swift -e '${swiftCode}'`, { encoding: 'utf8' });
  console.log(result);
} catch (error) {
  console.error(error);
}
