import { useEffect, useRef, useState } from 'react';
import { errorMessage, postApi } from './api';

/** Capture real browser audio, release the device, then request transcription. */
export function useMicrophone(onTranscript: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimer = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const release = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); }
      release();
    };
  }, []);
  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    release();
    setRecording(false);
  };
  const start = async () => {
    if (recording || pending) return;
    setPending(true); setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Microphone recording is unavailable in this browser. Enter text instead.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; release(); setRecording(false); setPending(false); setError('Microphone recording failed. Enter text or try again.'); };
      recorder.onstop = async () => {
        release();
        if (!alive.current || failed) return;
        setRecording(false); setPending(true);
        const controller = new AbortController(); requestRef.current = controller;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (!blob.size) throw new Error('No audio was recorded. Check your microphone and try again.');
          const base64Audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Recorded audio could not be read.'));
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.readAsDataURL(blob);
          });
          const data = await postApi('/api/transcribe', { base64Audio, mimeType: blob.type }, controller.signal);
          if (data.isFallback || !data.text?.trim()) throw new Error('Transcription returned no verified speech. Enter text or try again.');
          if (alive.current) callback.current(data.text);
        } catch (err) { if (alive.current) setError(errorMessage(err)); }
        finally { if (alive.current) setPending(false); }
      };
      recorder.start(); setRecording(true); setPending(false);
      stopTimer.current = window.setTimeout(stop, 30000);
    } catch (err) {
      release();
      if (alive.current) { setError(`Microphone unavailable: ${errorMessage(err)}`); setPending(false); }
    }
  };
  return { recording, pending, error, start, stop };
}
