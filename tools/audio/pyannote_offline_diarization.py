#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import warnings
from pathlib import Path


warnings.filterwarnings(
    "ignore",
    message=r".*torchcodec is not installed correctly.*",
)
warnings.filterwarnings(
    "ignore",
    message=r".*degrees of freedom is <= 0.*",
)


def format_time_label(seconds: float) -> str:
    if seconds is None or seconds < 0:
        return "00:00"
    rounded = int(round(seconds))
    hours = rounded // 3600
    minutes = (rounded % 3600) // 60
    secs = rounded % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline pyannote speaker diarization runner")
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model-dir")
    parser.add_argument("--model-id", default="pyannote/speaker-diarization-community-1")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--num-speakers", type=int)
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    parser.add_argument("--transcript-hint", default="")
    parser.add_argument("--allow-online-bootstrap", action="store_true")
    parser.add_argument("--window-seconds", type=float)
    parser.add_argument("--window-overlap-seconds", type=float, default=10.0)
    parser.add_argument("--windowed-threshold-seconds", type=float)
    return parser


def resolve_model_source(args) -> str:
    if args.model_dir:
        model_path = Path(args.model_dir).expanduser().resolve()
        if model_path.exists():
            return str(model_path)
        if not args.allow_online_bootstrap:
            raise FileNotFoundError(
                f"Local pyannote model directory not found: {model_path}. "
                "Seed it once from Hugging Face or set PYANNOTE_ALLOW_ONLINE_BOOTSTRAP=true with an HF token."
            )

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if not args.allow_online_bootstrap:
        raise RuntimeError(
            "Offline bootstrap is disabled and no local model directory is available. "
            "Set PYANNOTE_MODEL_DIR to a cloned model directory."
        )
    if not token:
        raise RuntimeError(
            "HF_TOKEN or HUGGINGFACE_HUB_TOKEN is required for the first gated model download."
        )
    if args.model_dir:
        from huggingface_hub import snapshot_download

        model_path = Path(args.model_dir).expanduser().resolve()
        model_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=args.model_id,
            local_dir=str(model_path),
            token=token,
        )
        return str(model_path)
    return args.model_id


def load_audio_tensor(audio_path: Path, torch_module):
    import soundfile as sf

    waveform, sample_rate = sf.read(str(audio_path), always_2d=True, dtype="float32")
    tensor = torch_module.from_numpy(waveform.T)
    return tensor, int(sample_rate)


def resolve_annotation(output):
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = getattr(output, "speaker_diarization", None)
    if annotation is None:
        annotation = output
    return annotation, getattr(output, "exclusive_speaker_diarization", None) is not None


def build_segment_rows(annotation, offset_seconds: float = 0.0, window_index: int = 0, exclusive_available: bool = False):
    segments = []
    for index, (segment, _, speaker) in enumerate(annotation.itertracks(yield_label=True), start=1):
        start_seconds = float(segment.start) + offset_seconds
        end_seconds = float(segment.end) + offset_seconds
        if end_seconds <= start_seconds:
            continue
        flags = ["exclusive_diarization"] if exclusive_available else []
        segments.append(
            {
                "segmentId": f"w{window_index + 1}_seg_{index}",
                "speakerId": str(speaker),
                "localSpeakerId": str(speaker),
                "speakerRole": "unknown",
                "speakerLabel": str(speaker),
                "startLabel": format_time_label(start_seconds),
                "endLabel": format_time_label(end_seconds),
                "startSeconds": start_seconds,
                "endSeconds": end_seconds,
                "text": "",
                "normalizedText": "",
                "confidence": None,
                "flags": flags,
            }
        )
    return segments


def compute_overlap_seconds(left, right) -> float:
    return max(
        0.0,
        min(float(left["endSeconds"]), float(right["endSeconds"])) - max(float(left["startSeconds"]), float(right["startSeconds"])),
    )


def assign_window_speakers(existing_segments, window_segments, next_speaker_index: int, overlap_start: float, overlap_end: float):
    overlap_existing = [
        segment
        for segment in existing_segments
        if float(segment["endSeconds"]) > overlap_start and float(segment["startSeconds"]) < overlap_end
    ]
    scores = {}

    for segment in window_segments:
        if float(segment["endSeconds"]) <= overlap_start or float(segment["startSeconds"]) >= overlap_end:
            continue
        local_speaker_id = segment["localSpeakerId"]
        for previous in overlap_existing:
            overlap_seconds = compute_overlap_seconds(segment, previous)
            if overlap_seconds <= 0:
                continue
            key = (local_speaker_id, previous["speakerId"])
            scores[key] = scores.get(key, 0.0) + overlap_seconds

    local_to_global = {}
    used_global_ids = set()
    ranked_pairs = sorted(
        ((score, local_id, global_id) for (local_id, global_id), score in scores.items()),
        reverse=True,
    )
    for score, local_id, global_id in ranked_pairs:
        if score < 0.25 or local_id in local_to_global or global_id in used_global_ids:
            continue
        local_to_global[local_id] = global_id
        used_global_ids.add(global_id)

    unmatched_local_ids = set()
    for local_speaker_id in {segment["localSpeakerId"] for segment in window_segments}:
        if local_speaker_id in local_to_global:
            continue
        local_to_global[local_speaker_id] = f"spk_global_{next_speaker_index}"
        unmatched_local_ids.add(local_speaker_id)
        next_speaker_index += 1

    assigned_segments = []
    for segment in window_segments:
        local_speaker_id = segment["localSpeakerId"]
        flags = list(segment.get("flags", []))
        flags.append("windowed_diarization")
        if unmatched_local_ids and local_speaker_id in unmatched_local_ids:
            flags.append("window_speaker_unmatched")
        assigned_segments.append(
            {
                **segment,
                "speakerId": local_to_global[local_speaker_id],
                "flags": sorted(set(flags)),
            }
        )

    return assigned_segments, next_speaker_index


def coalesce_segments(segments, gap_tolerance_seconds: float = 0.35):
    ordered = sorted(
        segments,
        key=lambda segment: (
            float(segment["startSeconds"]),
            float(segment["endSeconds"]),
            str(segment["speakerId"]),
        ),
    )
    merged = []
    for segment in ordered:
        if not merged:
            merged.append(dict(segment))
            continue
        previous = merged[-1]
        if (
            previous["speakerId"] == segment["speakerId"]
            and float(segment["startSeconds"]) <= float(previous["endSeconds"]) + gap_tolerance_seconds
        ):
            previous["startSeconds"] = min(float(previous["startSeconds"]), float(segment["startSeconds"]))
            previous["endSeconds"] = max(float(previous["endSeconds"]), float(segment["endSeconds"]))
            previous["startLabel"] = format_time_label(previous["startSeconds"])
            previous["endLabel"] = format_time_label(previous["endSeconds"])
            previous["flags"] = sorted(set(previous.get("flags", [])) | set(segment.get("flags", [])))
            continue
        merged.append(dict(segment))
    return merged


def normalize_speakers_and_segments(segments):
    normalized_segments = []
    speaker_id_map = {}
    for segment in sorted(segments, key=lambda item: (float(item["startSeconds"]), float(item["endSeconds"]))):
        raw_speaker_id = str(segment.get("speakerId") or segment.get("localSpeakerId") or "spk_unknown")
        if raw_speaker_id not in speaker_id_map:
            speaker_id_map[raw_speaker_id] = f"spk_{len(speaker_id_map) + 1}"
        normalized_speaker_id = speaker_id_map[raw_speaker_id]
        speaker_number = normalized_speaker_id.split("_")[-1]
        normalized_segments.append(
            {
                **segment,
                "segmentId": f"seg_{len(normalized_segments) + 1}",
                "speakerId": normalized_speaker_id,
                "speakerLabel": f"Speaker {speaker_number}",
                "startLabel": format_time_label(float(segment["startSeconds"])),
                "endLabel": format_time_label(float(segment["endSeconds"])),
            }
        )

    speakers = [
        {
            "id": normalized_id,
            "label": f"Speaker {normalized_id.split('_')[-1]}",
            "role": "unknown",
            "confidence": None,
        }
        for normalized_id in speaker_id_map.values()
    ]

    return speakers, normalized_segments


def run_windowed_diarization(
    pipeline,
    waveform,
    sample_rate: int,
    inference_kwargs: dict,
    total_duration_seconds: float,
    window_seconds: float,
    window_overlap_seconds: float,
):
    if window_seconds <= 0:
        raise ValueError("window_seconds must be positive")

    step_seconds = window_seconds - window_overlap_seconds
    if step_seconds <= 0:
        raise ValueError("window_overlap_seconds must be smaller than window_seconds")

    total_samples = int(waveform.shape[1])
    window_results = []
    window_start_seconds = 0.0
    window_index = 0
    any_exclusive_available = False

    while window_start_seconds < total_duration_seconds:
        window_end_seconds = min(total_duration_seconds, window_start_seconds + window_seconds)
        start_sample = max(0, int(round(window_start_seconds * sample_rate)))
        end_sample = min(total_samples, int(round(window_end_seconds * sample_rate)))
        if end_sample <= start_sample:
            break

        window_waveform = waveform[:, start_sample:end_sample]
        output = pipeline({"waveform": window_waveform, "sample_rate": sample_rate}, **inference_kwargs)
        annotation, exclusive_available = resolve_annotation(output)
        any_exclusive_available = any_exclusive_available or exclusive_available
        window_results.append(
            {
                "index": window_index,
                "startSeconds": window_start_seconds,
                "endSeconds": window_end_seconds,
                "segments": build_segment_rows(
                    annotation,
                    offset_seconds=window_start_seconds,
                    window_index=window_index,
                    exclusive_available=exclusive_available,
                ),
            }
        )

        if window_end_seconds >= total_duration_seconds:
            break
        window_index += 1
        window_start_seconds += step_seconds

    merged_segments = []
    next_speaker_index = 1
    for window in window_results:
        segments = window["segments"]
        if not segments:
            continue

        if not merged_segments:
            local_to_global = {}
            for segment in segments:
                local_speaker_id = segment["localSpeakerId"]
                if local_speaker_id not in local_to_global:
                    local_to_global[local_speaker_id] = f"spk_global_{next_speaker_index}"
                    next_speaker_index += 1
            assigned_segments = [
                {
                    **segment,
                    "speakerId": local_to_global[segment["localSpeakerId"]],
                    "flags": sorted(set(segment.get("flags", [])) | {"windowed_diarization"}),
                }
                for segment in segments
            ]
        else:
            overlap_start = float(window["startSeconds"])
            overlap_end = min(float(window["endSeconds"]), overlap_start + max(0.0, window_overlap_seconds))
            assigned_segments, next_speaker_index = assign_window_speakers(
                merged_segments,
                segments,
                next_speaker_index,
                overlap_start,
                overlap_end,
            )

        merged_segments.extend(assigned_segments)

    return coalesce_segments(merged_segments), len(window_results), any_exclusive_available


def build_success_payload(
    *,
    model_id: str,
    transcript_hint: str,
    started_at: float,
    source: str,
    exclusive_available: bool,
    segments,
    metadata: dict | None = None,
):
    speakers, normalized_segments = normalize_speakers_and_segments(segments)
    payload_metadata = {
        "backend": "pyannote_diarization",
        "model": model_id,
        "source": source,
        "exclusiveAvailable": exclusive_available,
    }
    if metadata:
        payload_metadata.update(metadata)

    return {
        "success": True,
        "model": model_id,
        "latencyMs": int(round((time.time() - started_at) * 1000)),
        "data": {
            "language": None,
            "rawText": transcript_hint or "",
            "normalizedText": transcript_hint or "",
            "speakers": speakers,
            "segments": normalized_segments,
            "quality": {
                "overallConfidence": None,
                "lowConfidenceSegmentCount": 0,
                "speakerCount": len(speakers),
                "speakerAmbiguityCount": len(normalized_segments),
                "overlappingSpeechSuspected": False,
            },
            "metadata": payload_metadata,
        },
    }


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    started_at = time.time()

    try:
        audio_path = Path(args.audio_path).expanduser().resolve()
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        model_source = resolve_model_source(args)

        try:
            import torch
        except ImportError as exc:
            raise RuntimeError(
                "PyTorch is not available for offline pyannote diarization."
            ) from exc
        try:
            import soundfile  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "soundfile is not available for offline pyannote diarization."
            ) from exc
        try:
            from pyannote.audio import Pipeline
        except ImportError as exc:
            raise RuntimeError(
                "pyannote.audio is not installed. Install pyannote.audio and its audio dependencies in the configured Python environment."
            ) from exc

        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        pipeline_kwargs = {}
        if not Path(model_source).exists() and token:
            pipeline_kwargs["token"] = token

        pipeline = Pipeline.from_pretrained(model_source, **pipeline_kwargs)

        if args.device and args.device != "cpu":
            pipeline.to(torch.device(args.device))

        inference_kwargs = {}
        if args.num_speakers is not None:
            inference_kwargs["num_speakers"] = args.num_speakers
        if args.min_speakers is not None:
            inference_kwargs["min_speakers"] = args.min_speakers
        if args.max_speakers is not None:
            inference_kwargs["max_speakers"] = args.max_speakers

        waveform, sample_rate = load_audio_tensor(audio_path, torch)
        total_duration_seconds = float(waveform.shape[1]) / float(sample_rate)
        window_seconds = float(args.window_seconds) if args.window_seconds and args.window_seconds > 0 else None
        threshold_seconds = (
            float(args.windowed_threshold_seconds)
            if args.windowed_threshold_seconds and args.windowed_threshold_seconds > 0
            else None
        )
        should_window = bool(
            window_seconds
            and total_duration_seconds > max(window_seconds, threshold_seconds or 0.0)
        )

        if should_window:
            segments, window_count, exclusive_available = run_windowed_diarization(
                pipeline,
                waveform,
                sample_rate,
                inference_kwargs,
                total_duration_seconds,
                window_seconds,
                max(0.0, float(args.window_overlap_seconds or 0.0)),
            )
            payload = build_success_payload(
                model_id=args.model_id,
                transcript_hint=args.transcript_hint,
                started_at=started_at,
                source="local_model_dir" if Path(model_source).exists() else "hub_download",
                exclusive_available=exclusive_available,
                segments=segments,
                metadata={
                    "windowed": True,
                    "windowSeconds": window_seconds,
                    "windowOverlapSeconds": max(0.0, float(args.window_overlap_seconds or 0.0)),
                    "windowCount": window_count,
                    "audioDurationSeconds": round(total_duration_seconds, 3),
                    "speakerStitching": "overlap_greedy",
                },
            )
        else:
            output = pipeline({"waveform": waveform, "sample_rate": sample_rate}, **inference_kwargs)
            annotation, exclusive_available = resolve_annotation(output)
            payload = build_success_payload(
                model_id=args.model_id,
                transcript_hint=args.transcript_hint,
                started_at=started_at,
                source="local_model_dir" if Path(model_source).exists() else "hub_download",
                exclusive_available=exclusive_available,
                segments=build_segment_rows(annotation),
                metadata={
                    "windowed": False,
                    "audioDurationSeconds": round(total_duration_seconds, 3),
                },
            )
        print(json.dumps(payload))
        return 0
    except Exception as exc:
        payload = {
            "success": False,
            "error": str(exc),
            "latencyMs": int(round((time.time() - started_at) * 1000)),
        }
        print(json.dumps(payload))
        return 1


if __name__ == "__main__":
    sys.exit(main())
