import UIKit
import WebKit
import AVFoundation

class WebViewController: UIViewController, WKScriptMessageHandler, AVSpeechSynthesizerDelegate, WKNavigationDelegate, AVAudioPlayerDelegate {
    private var webView: WKWebView!
    /// 实时合成器（回退通道）
    private let synthesizer = AVSpeechSynthesizer()
    /// 文件播放器（主通路：离线渲染 → AVAudioPlayer，普通音频播放、可靠出声）
    private var player: AVAudioPlayer?
    /// 当前等待完成回调的朗读 id（JS 严格串行，同一时间只有一组）
    private var pendingTTSId: Int?
    /// 实时合成回退通道的组内 utterance
    private var seqUtterances: [AVSpeechUtterance] = []
    /// 已排入队列的定时器（新请求/停止时统一取消）
    private var timers: [DispatchWorkItem] = []
    /// 渲染会话标记（delegate 回调里区分"渲染到文件"与"实时合成"）
    private var renderUtterance: AVSpeechUtterance?
    private var renderSynth: AVSpeechSynthesizer?
    private var renderFile: AVAudioFile?
    private var renderURL: URL?
    private var renderCompletion: ((URL?) -> Void)?
    /// 播放链上下文（audioPlayerDidFinishPlaying 推进用）
    private var chainURLs: [URL]?
    private var chainIndex = 0
    private var chainId = 0

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        // 单词发音 <audio> 无需用户手势即可播放
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(self, name: "nativeTTS")
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        synthesizer.delegate = self        // 不设置则 didStart/didFinish 全部不触发
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
    //   { id, texts: [..] }   整组朗读（离线渲染为音频文件 → AVAudioPlayer 依次播放，句间 1 秒）
    //   { id, text }          单条朗读
    //   { stop: true }        停止一切朗读
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeTTS", let body = message.body as? [String: Any] else { return }
        if (body["stop"] as? Bool) == true {
            NSLog("[TTS] stop requested")
            cancelTimers()
            pendingTTSId = nil
            player?.stop(); player = nil
            synthesizer.stopSpeaking(at: .immediate)
            renderSynth?.stopSpeaking(at: .immediate)
            return
        }
        guard let id = body["id"] as? Int else { return }
        if let texts = body["texts"] as? [String], !texts.isEmpty {
            speakSequenceNative(id: id, texts: texts)
        } else if let text = body["text"] as? String {
            speakNative(id: id, text: text)
        }
    }

    // MARK: - 朗读编排
    private func assertAudioSession() {
        // WKWebView 播放 <audio>（有道单词发音）会接管音频会话，每次出声前重新接管
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true, options: [])
    }

    private func makeUtterance(_ text: String) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.45                       // 放慢，适合儿童跟读
        return utterance
    }

    /// 整组朗读主通路：离线渲染全部句子为音频文件 → AVAudioPlayer 依次播放（句间 1 秒）
    private func speakSequenceNative(id: Int, texts: [String]) {
        NSLog("[TTS] sequence #%d: %d items", id, texts.count)
        cancelTimers()
        player?.stop(); player = nil
        synthesizer.stopSpeaking(at: .immediate)
        pendingTTSId = id
        // JS 进度：第 0 项（单词）立即标记开始，驱动学习卡高亮/门控
        webView?.evaluateJavaScript("NG.audio.__nativeTtsItem(\(id),0)", completionHandler: nil)
        renderAll(texts) { [weak self] urls in
            guard let self = self, self.pendingTTSId == id else { return }
            if let ok = urls as? [URL], !ok.isEmpty, ok.allSatisfy({ $0 != nil }) {
                self.playFiles(ok, id: id)                        // 主通路：文件播放（可靠出声）
            } else {
                NSLog("[TTS] render failed → live synth fallback")
                self.speakLiveSequence(id: id, texts: texts)      // 回退：实时合成
            }
        }
    }

    /// 单条朗读
    private func speakNative(id: Int, text: String) {
        NSLog("[TTS] speak #%d: %@", id, text)
        cancelTimers()
        player?.stop(); player = nil
        synthesizer.stopSpeaking(at: .immediate)
        pendingTTSId = id
        renderAll([text]) { [weak self] urls in
            guard let self = self, self.pendingTTSId == id else { return }
            if let url = urls[0] {
                self.playFiles([url], id: id)
            } else {
                self.speakLive(id: id, text: text)
            }
        }
    }

    // MARK: - 离线渲染（AVSpeech 渲染引擎 → CAF 文件，磁盘缓存）
    private func ttsFileURL(_ text: String) -> URL {
        var h: UInt64 = 5381
        for b in text.utf8 { h = ((h << 5) &+ h) &+ UInt64(b) }
        return URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("tts_\(h).caf")
    }

    private func synthesizeToFile(_ text: String, completion: @escaping (URL?) -> Void) {
        if #available(iOS 13.0, *) {
            let url = ttsFileURL(text)
            if FileManager.default.fileExists(atPath: url.path) {
                NSLog("[TTS] cache hit: %@", url.lastPathComponent)
                completion(url)
                return
            }
            NSLog("[TTS] render to file: %@", text)
            renderURL = url
            renderFile = nil
            renderCompletion = completion
            let synth = AVSpeechSynthesizer()
            synth.delegate = self
            renderSynth = synth
            let utterance = makeUtterance(text)
            renderUtterance = utterance
            // write() 把合成结果经 buffer 回调落盘为 CAF；该合成器的 didFinish 标记渲染结束
            synth.write(utterance) { [weak self] (buffer: AVAudioBuffer) in
                guard let self = self, let pcm = buffer as? AVAudioPCMBuffer else { return }
                if self.renderFile == nil {
                    self.renderFile = try? AVAudioFile(forWriting: url, settings: pcm.format.settings)
                }
                try? self.renderFile?.write(from: pcm)
            }
            // 渲染防挂起：12 秒未完成 → 放弃（finishRender(nil) 触发失败回调）
            let work = DispatchWorkItem { [weak self] in
                guard let self = self, self.renderUtterance != nil else { return }
                NSLog("[TTS] render timeout")
                self.finishRender(ok: false)
            }
            timers.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: work)
        } else {
            completion(nil)
        }
    }

    /// 渲染结束（成功或超时）统一出口；幂等
    private func finishRender(ok: Bool) {
        guard renderUtterance != nil else { return }
        renderUtterance = nil
        let cb = renderCompletion
        renderCompletion = nil
        cb?(ok ? renderURL : nil)
    }

    /// 串行渲染全部文本（磁盘缓存命中直接通过）
    private func renderAll(_ texts: [String], completion: @escaping ([URL?]) -> Void) {
        var urls = [URL?](repeating: nil, count: texts.count)
        func next(_ i: Int) {
            guard pendingTTSId != nil else { return }        // 已被新请求/停止取代
            if i >= texts.count { completion(urls); return }
            synthesizeToFile(texts[i]) { [weak self] url in
                guard let self = self else { return }
                urls[i] = url
                next(i + 1)
            }
        }
        next(0)
    }

    // MARK: - 文件播放链（句间 1 秒）
    private func playFiles(_ urls: [URL], id: Int) {
        NSLog("[TTS] play %d files", urls.count)
        chainURLs = urls
        chainId = id
        playAt(0, id: id)
    }

    private func playAt(_ i: Int, id: Int) {
        guard pendingTTSId == id, let urls = chainURLs, i < urls.count else { return }
        chainIndex = i
        webView?.evaluateJavaScript("NG.audio.__nativeTtsItem(\(id),\(i))", completionHandler: nil)
        guard let p = try? AVAudioPlayer(contentsOf: urls[i]) else {
            advanceChain(i)
            return
        }
        player = p
        p.delegate = self
        p.play()
    }

    /// 一句播放结束后推进：句间停顿 1 秒 / 整组完成通知 JS
    private func advanceChain(_ finishedIndex: Int) {
        guard let urls = chainURLs, pendingTTSId == chainId else { return }
        if finishedIndex + 1 < urls.count {
            let work = DispatchWorkItem { [weak self] in self?.playAt(finishedIndex + 1, id: self?.chainId ?? 0) }
            timers.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)   // 句间停顿 1 秒
        } else {
            NSLog("[TTS] sequence done")
            notifyDone()
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === self.player, chainURLs != nil else { return }
        advanceChain(chainIndex)
    }

    // MARK: - 实时合成回退通道（渲染不可用时）
    private func speakLiveSequence(id: Int, texts: [String]) {
        NSLog("[TTS] live sequence fallback #%d", id)
        synthesizer.stopSpeaking(at: .immediate)
        seqUtterances.removeAll()
        var delay = 0.06
        for (i, text) in texts.enumerated() {
            let utterance = makeUtterance(text)
            utterance.postUtteranceDelay = (i == texts.count - 1) ? 0.05 : 1.0
            seqUtterances.append(utterance)
            let work = DispatchWorkItem { [weak self] in
                guard let self = self, self.pendingTTSId == id else { return }
                self.synthesizer.speak(utterance)
                self.webView?.evaluateJavaScript("NG.audio.__nativeTtsItem(\(id),\(i))", completionHandler: nil)
            }
            timers.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
            delay += 0.06
        }
        let total = 0.8 + Double(texts.reduce(0) { $0 + $1.count }) * 0.17 + Double(texts.count - 1) * 1.0 + 3.0
        armBackup(id: id, estimate: total)
    }

    private func speakLive(id: Int, text: String) {
        synthesizer.stopSpeaking(at: .immediate)
        seqUtterances.removeAll()
        let utterance = makeUtterance(text)
        utterance.postUtteranceDelay = 0.05
        seqUtterances = [utterance]
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            self.synthesizer.speak(utterance)
        }
        timers.append(work)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06, execute: work)
        armBackup(id: id, estimate: 1.0 + Double(text.count) * 0.13)
    }

    // MARK: - 定时器与完成
    private func armBackup(id: Int, estimate: TimeInterval) {
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, self.pendingTTSId == id else { return }
            NSLog("[TTS] backup-fire #%d (delegate missed)", id)
            self.notifyDone()
        }
        timers.append(work)
        DispatchQueue.main.asyncAfter(deadline: .now() + estimate, execute: work)
    }

    private func cancelTimers() {
        timers.forEach { $0.cancel() }
        timers.removeAll()
        seqUtterances.removeAll()
    }

    private func notifyDone() {
        guard let id = pendingTTSId else { return }
        pendingTTSId = nil
        webView?.evaluateJavaScript("NG.audio.__nativeTtsDone(\(id))", completionHandler: nil)
    }

    // MARK: - 合成器回调（渲染结束检测 + 实时回退通道完成）
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        // 1) 渲染会话：write() 结束 → 关闭文件并回调文件 URL
        if renderUtterance === utterance {
            NSLog("[TTS] render finished: %@", renderURL?.lastPathComponent ?? "?")
            finishRender(ok: true)
            return
        }
        // 2) 实时回退通道：整组最后一条完成 → 通知 JS
        if let last = seqUtterances.last, utterance === last {
            NSLog("[TTS] live sequence didFinish")
            notifyDone()
        }
    }

    // MARK: - WKNavigationDelegate：允许一切导航（本地内容 + 有道音频）
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(.allow)
    }
}
