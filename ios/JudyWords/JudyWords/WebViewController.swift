import UIKit
import WebKit
import AVFoundation

class WebViewController: UIViewController, WKScriptMessageHandler, AVSpeechSynthesizerDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private let synthesizer = AVSpeechSynthesizer()
    /// 当前等待完成回调的朗读 id（JS 严格串行，同一时间只有一组）
    private var pendingTTSId: Int?
    /// 当前组内的所有 utterance（用于 didStart 定位进度下标）
    private var seqUtterances: [AVSpeechUtterance] = []
    /// 已真实开口（收到 didStart）的句子下标，用于抑制兜底链重复发进度
    private var startedIndices: Set<Int> = []
    /// 已排入队列的定时器（新请求/停止时统一取消）
    private var timers: [DispatchWorkItem] = []

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        // 单词发音 <audio> 无需用户手势即可播放
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(self, name: "nativeTTS")
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        synthesizer.delegate = self        // 关键：不设置则 didStart/didFinish 全部不触发
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
    // 消息格式：
    //   { id, texts: [..] }   整组朗读（AVSpeech 队列原生排播，句间 1 秒）
    //   { id, text }          单条朗读
    //   { stop: true }        停止一切朗读
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeTTS", let body = message.body as? [String: Any] else { return }
        if (body["stop"] as? Bool) == true {
            NSLog("[TTS] stop requested")
            cancelTimers()
            pendingTTSId = nil
            synthesizer.stopSpeaking(at: .immediate)
            return
        }
        guard let id = body["id"] as? Int else { return }
        if let texts = body["texts"] as? [String], !texts.isEmpty {
            speakSequenceNative(id: id, texts: texts)
        } else if let text = body["text"] as? String {
            speakNative(id: id, text: text)
        }
    }

    // MARK: 朗读核心
    private func assertAudioSession() {
        // WKWebView 播放 <audio>（有道单词发音）会接管音频会话导致原生合成静音，
        // 因此每次朗读前重新接管。
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true, options: [])
    }

    private func makeUtterance(_ text: String) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.45                       // 放慢，适合儿童跟读
        return utterance
    }

    /// 单条朗读
    private func speakNative(id: Int, text: String) {
        NSLog("[TTS] speak #%d: %@", id, text)
        cancelTimers()
        synthesizer.stopSpeaking(at: .immediate)
        assertAudioSession()
        let utterance = makeUtterance(text)
        utterance.postUtteranceDelay = 0.05
        seqUtterances = [utterance]
        pendingTTSId = id
        enqueue(utterance, id: id, delay: 0.06)
        // 完成备份回调：部分 iOS 版本 didFinish 不可靠，超时按估算补发推进信号
        armBackup(id: id, estimate: 1.0 + Double(text.count) * 0.13)
    }

    /// 整组朗读（学习卡：单词 → 例句×3）。AVSpeech 队列依次朗读，postUtteranceDelay 提供原生 1 秒句间停顿。
    /// 进度回调只由 didStart 驱动（真正开口才推进高亮）；另按估时排一条单调递增兜底链，
    /// 覆盖 didStart 个别丢失的句子。JS 侧另有 idx 单调守卫，乱序/重复一律忽略。
    private func speakSequenceNative(id: Int, texts: [String]) {
        NSLog("[TTS] sequence #%d: %d items", id, texts.count)
        cancelTimers()
        synthesizer.stopSpeaking(at: .immediate)
        assertAudioSession()
        pendingTTSId = id
        startedIndices.removeAll()
        var delay = 0.06
        var cumulativeStart = delay
        for (i, text) in texts.enumerated() {
            let utterance = makeUtterance(text)
            utterance.postUtteranceDelay = (i == texts.count - 1) ? 0.05 : 1.0   // 原生 1 秒句间停顿
            seqUtterances.append(utterance)
            enqueue(utterance, id: id, delay: delay)
            if i > 0 { armItemFallback(id: id, index: i, at: cumulativeStart) }
            delay += 0.06
            cumulativeStart += estimateDuration(text) + (i == texts.count - 1 ? 0 : 1.0)
        }
        // 完成备份：估算总时长 + 3s 余量（didFinish 正常时到不了这里）
        let total = texts.reduce(0.8) { $0 + estimateDuration($1) } + Double(texts.count - 1) * 1.0 + 3.0
        armBackup(id: id, estimate: total)
    }

    /// 慢速朗读估时（rate 0.45 ≈ 6-7 字符/秒）
    private func estimateDuration(_ text: String) -> Double {
        return 0.5 + Double(text.count) * 0.17
    }

    private func enqueue(_ utterance: AVSpeechUtterance, id: Int, delay: TimeInterval) {
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            self.synthesizer.speak(utterance)   // 只入队，不发进度（进度由 didStart 驱动）
        }
        timers.append(work)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// 兜底：若某句到估时开始点仍未收到 didStart，则补发进度（JS 单调守卫保证不回退）
    private func armItemFallback(id: Int, index: Int, at start: TimeInterval) {
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            guard !self.startedIndices.contains(index) else { return }
            NSLog("[TTS] item-fallback #%d idx%d (didStart missed)", id, index)
            self.webView?.evaluateJavaScript("NG.audio.__nativeTtsItem(\(id),\(index))", completionHandler: nil)
        }
        timers.append(work)
        DispatchQueue.main.asyncAfter(deadline: .now() + start, execute: work)
    }

    private func armBackup(id: Int, estimate: TimeInterval) {
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            NSLog("[TTS] backup-fire #%d (didFinish missed)", id)
            self.notifyDone()
        }
        timers.append(work)
        DispatchQueue.main.asyncAfter(deadline: .now() + estimate, execute: work)
    }

    private func cancelTimers() {
        timers.forEach { $0.cancel() }
        timers.removeAll()
        seqUtterances.removeAll()
        startedIndices.removeAll()
    }

    // MARK: - 合成器回调
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        // 句子真正开始朗读 → 回传进度（学习卡高亮/门控解锁用）
        if let idx = seqUtterances.firstIndex(where: { $0 === utterance }) {
            startedIndices.insert(idx)
            webView?.evaluateJavaScript("NG.audio.__nativeTtsItem(\(pendingTTSId ?? -1),\(idx))", completionHandler: nil)
            NSLog("[TTS] didStart idx%d", idx)
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        // 只在整组最后一条完成时通知 JS（组内单句完成由 didStart 顺序隐式表达）
        if let last = seqUtterances.last, utterance === last {
            NSLog("[TTS] sequence didFinish")
            notifyDone()
        }
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
