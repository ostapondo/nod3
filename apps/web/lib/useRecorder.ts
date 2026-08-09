'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecorderState {
  /** 0..1, smoothed — drives the level meter. */
  level: number
  /** ms since the mic last heard you. Drives the "you have gone quiet" nudge. */
  silentForMs: number
  error: string | null
  ready: boolean
}

/** Below this RMS the mic is considered silent. Tuned against laptop noise floor. */
const SPEECH_THRESHOLD = 0.012

/**
 * Captures the microphone for the whole session into one blob, and exposes a
 * live level so the UI can show you when you have stopped talking.
 *
 * Everything stays in memory until you finish; nothing is streamed anywhere.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    level: 0,
    silentForMs: 0,
    error: null,
    ready: false,
  })

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastVoiceRef = useRef<number>(Date.now())

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      streamRef.current = stream

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      // Timeslice so a crash still leaves most of the audio recoverable.
      recorder.start(5_000)
      recorderRef.current = recorder

      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)

      const buffer = new Float32Array(analyser.fftSize)
      lastVoiceRef.current = Date.now()

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) sum += buffer[i]! * buffer[i]!
        const rms = Math.sqrt(sum / buffer.length)

        if (rms > SPEECH_THRESHOLD) lastVoiceRef.current = Date.now()

        setState((s) => ({
          ...s,
          // Compress the range so normal speech sits mid-meter instead of pinned.
          level: Math.min(1, Math.pow(rms * 12, 0.6)),
          silentForMs: Date.now() - lastVoiceRef.current,
        }))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()

      setState((s) => ({ ...s, ready: true, error: null }))
      return true
    } catch (err) {
      setState((s) => ({
        ...s,
        ready: false,
        error:
          err instanceof Error
            ? `Microphone unavailable: ${err.message}`
            : 'Microphone unavailable',
      }))
      return false
    }
  }, [])

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null

    const recorder = recorderRef.current
    let blob: Blob | null = null
    if (recorder && recorder.state !== 'inactive') {
      blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
        recorder.stop()
      })
    }

    streamRef.current?.getTracks().forEach((t) => t.stop())
    await audioCtxRef.current?.close().catch(() => {})
    streamRef.current = null
    recorderRef.current = null
    audioCtxRef.current = null
    setState((s) => ({ ...s, ready: false, level: 0 }))
    return blob
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [])

  return { ...state, start, stop }
}
