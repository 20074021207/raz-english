import UIKit
import WebKit
import AVFoundation

class WebViewController: UIViewController, WKScriptMessageHandler, AVSpeechSynthesizerDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private let synthesizer = AVSpeechSynthesizer()
    /// 当前等待完成回调的原生朗读 id（JS 严格串行，同一时间只有一个）
    private var pendingTTSId: Int?

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        // 单词发音 <audio> 无需用户手势即可播放
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(self, name: "nativeTTS")
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // H5 资源整体打包进 www/ 目录，完全离线加载
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            webView.loadFileURL(index, allowingReadAccessTo: Bundle.main.resourceURL!)
        }
    }

    // MARK: - JS → 原生 TTS 桥
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeTTS",
              let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let text = body["text"] as? String else { return }
        synthesizer.stopSpeaking(at: .immediate)   // 打断上一段（迟到的 didCancel 不会误触发新回调）
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.45                      // 放慢，适合儿童跟读
        utterance.postUtteranceDelay = 0.05
        pendingTTSId = id
        synthesizer.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        notifyDone()
    }

    // 被新朗读打断时的 didCancel 不回调（pendingTTSId 已被新 id 覆盖）

    private func notifyDone() {
        guard let id = pendingTTSId else { return }
        pendingTTSId = nil
        webView?.evaluateJavaScript("NG.audio.__nativeTtsDone(\(id))", completionHandler: nil)
    }

    // MARK: - WKNavigationDelegate：允许一切导航（本地内容 + 有道音频）
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(.allow)
    }
}
