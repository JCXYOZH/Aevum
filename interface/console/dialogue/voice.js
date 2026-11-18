/* voice.js — 安全的语音录制（MediaRecorder + 后端转写，不使用 Web Speech API） */
(function () {
    'use strict';
    let mediaStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let recording = false;

    window.VoiceInput = {
        get supported() {
            return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
        },
        get isRecording() { return recording; },

        async start(onState) {
            if (recording) return false;
            if (!this.supported) {
                if (onState) onState({ state: 'error', error: '当前环境不支持语音录制' });
                return false;
            }
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioChunks = [];
                const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
                mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });
                mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
                mediaRecorder.onstop = async () => {
                    if (onState) onState({ state: 'processing' });
                    try {
                        const blob = new Blob(audioChunks, { type: 'audio/webm' });
                        const formData = new FormData();
                        formData.append('audio', blob, 'recording.webm');
                        const resp = await fetch('/api/voice/transcribe', { method: 'POST', body: formData });
                        const data = await resp.json();
                        if (data.success && data.text) {
                            if (onState) onState({ state: 'result', text: data.text });
                        } else {
                            if (onState) onState({ state: 'error', error: data.error || '未识别到语音' });
                        }
                    } catch (err) {
                        if (onState) onState({ state: 'error', error: err.message });
                    } finally {
                        this._cleanup();
                    }
                };
                mediaRecorder.start();
                recording = true;
                if (onState) onState({ state: 'recording' });
                return true;
            } catch (err) {
                this._cleanup();
                if (onState) onState({ state: 'error', error: '无法访问麦克风：' + err.message });
                return false;
            }
        },

        stop() {
            if (!recording || !mediaRecorder) return;
            try { mediaRecorder.stop(); } catch (e) {}
            recording = false;
        },

        cancel() {
            if (!recording) return;
            recording = false;
            try { if (mediaRecorder) mediaRecorder.ondataavailable = null, mediaRecorder.onstop = null, mediaRecorder.stop(); } catch (e) {}
            this._cleanup();
        },

        _cleanup() {
            if (mediaStream) {
                mediaStream.getTracks().forEach(t => t.stop());
                mediaStream = null;
            }
            mediaRecorder = null;
            audioChunks = [];
        }
    };
})();
