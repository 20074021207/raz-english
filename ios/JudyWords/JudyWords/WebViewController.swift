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
        speakNative(id: id, text: text)
    }

    private func speakNative(id: Int, text: String) {
        NSLog("[TTS] speak #%d: %@", id, text)
        synthesizer.stopSpeaking(at: .immediate)
        // 关键修复：WKWebView 播放 <audio>（有道单词发音）会接管音频会话，
        // 导致之后的 AVSpeechSynthesizer 静音。每次朗读前必须重新接管会话。
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true, options: [])
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.45                      // 放慢，适合儿童跟读
        utterance.postUtteranceDelay = 0.05
        pendingTTSId = id
        // 给音频会话切换留一点时间，避免首字被吞
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            self.synthesizer.speak(utterance)
            NSLog("[TTS] started #%d", id)
        }
        // 完成备份回调：部分 iOS 版本 didFinish 不可靠（不触发时 JS 会干等防挂起超时）。
        // 按慢速朗读估算时长，超时仍未收到完成事件则补发推进信号（幂等：didFinish 先到则此处的 pending 已清空）。
        let estimate = 1.0 + Double(text.count) * 0.13
        DispatchQueue.main.asyncAfter(deadline: .now() + estimate) { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            NSLog("[TTS] backup-fire #%d (didFinish missed)", id)
            self.notifyDone()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        NSLog("[TTS] didFinish (pending=%@)", pendingTTSId.map(String.init) ?? "nil")
        notifyDone()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        NSLog("[TTS] didCancel (pending=%@)", pendingTTSId.map(String.init) ?? "nil")
    }

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
