import argparse
import json
import sys


def _default_factory(name):
    from faster_whisper import WhisperModel

    return WhisperModel(name, device="cpu", compute_type="int8")


def transcribe(path, model_name="small", language="pt", model_factory=None):
    model = (model_factory or _default_factory)(model_name)
    segments, info = model.transcribe(path, language=language, vad_filter=True, beam_size=5)
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": getattr(info, "language", language)}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Transcreve um áudio com faster-whisper")
    parser.add_argument("file")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="pt")
    args = parser.parse_args(argv)
    try:
        result = transcribe(args.file, args.model, args.language)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
