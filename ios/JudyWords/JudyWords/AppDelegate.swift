import UIKit
import WebKit
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 学习类 App：静音键下也要出声（儿童跟读场景）
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = WebViewController()
        window?.makeKeyAndVisible()

        // 调试钩子：SIMCTL_CHILD_DEBUG_AUTO_LESSON=1 启动时自动进入学习卡（模拟器自动化测试用）
        if ProcessInfo.processInfo.environment["DEBUG_AUTO_LESSON"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.webViewRoot()?.evaluateJavaScript(
                    "NG.state.s.placementDone = true; NG.state.save(); NG.app.go('lesson');",
                    completionHandler: nil)
            }
        }
        return true
    }

    private func webViewRoot() -> WKWebView? {
        window?.rootViewController?.view as? WKWebView
    }
}
