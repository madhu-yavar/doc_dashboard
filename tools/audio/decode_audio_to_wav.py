#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Decode supported audio input into analysis WAV.")
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--out-path", required=True)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        import soundfile as sf
    except ImportError as exc:
        payload = {
            "success": False,
            "error": "soundfile is not available in the configured Python environment.",
        }
        print(json.dumps(payload))
        return 1

    try:
        audio_path = Path(args.audio_path).expanduser().resolve()
        out_path = Path(args.out_path).expanduser().resolve()

        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        out_path.parent.mkdir(parents=True, exist_ok=True)

        waveform, sample_rate = sf.read(str(audio_path), always_2d=True, dtype="float32")
        sf.write(str(out_path), waveform, sample_rate, format="WAV", subtype="PCM_16")

        payload = {
            "success": True,
            "audioPath": str(audio_path),
            "outPath": str(out_path),
            "sampleRate": int(sample_rate),
            "channels": int(waveform.shape[1]),
            "frames": int(waveform.shape[0]),
            "durationSeconds": float(waveform.shape[0] / sample_rate) if sample_rate else 0.0,
        }
        print(json.dumps(payload))
        return 0
    except Exception as exc:
        payload = {
            "success": False,
            "error": str(exc),
        }
        print(json.dumps(payload))
        return 1


if __name__ == "__main__":
    sys.exit(main())
