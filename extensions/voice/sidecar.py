import argparse
import json
import sys

if sys.platform == "win32":
    import glob
    import os
    import site

    # ponytail: pip CUDA wheels hide their DLLs in site-packages, off PATH and off the DLL
    # search path, so register them here instead of asking for a full CUDA Toolkit install.
    for base in site.getsitepackages():
        for dlldir in glob.glob(os.path.join(base, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(dlldir)
            except Exception:
                pass
            os.environ["PATH"] = dlldir + os.pathsep + os.environ.get("PATH", "")

# ponytail: CPU float16 is too slow for interactive use, so a forced cpu device still gets int8.


def load_model(name, device, compute):
    from faster_whisper import WhisperModel

    if device == "auto":
        try:
            return WhisperModel(name, device="cuda", compute_type="float16" if compute == "auto" else compute), "cuda"
        except Exception as exc:
            print(json.dumps({"log": f"cuda unavailable ({exc}), using cpu"}), file=sys.stderr, flush=True)
            return WhisperModel(name, device="cpu", compute_type="int8" if compute == "auto" else compute), "cpu"
    kind = "int8" if (device == "cpu" and compute == "auto") else compute
    return WhisperModel(name, device=device, compute_type=kind), device


def exit_with_parent(pid):
    # ponytail: a pi killed from outside never sends "shutdown" and the py launcher keeps our stdin
    # open, so a leaked model would sit in VRAM; wait on the parent handle instead (Windows only).
    if sys.platform != "win32" or not pid:
        return
    import ctypes
    import threading

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x00100000, False, int(pid))
    if not handle:
        return

    def watch():
        kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute", default="auto")
    parser.add_argument("--beam", type=int, default=5)
    parser.add_argument("--parent", type=int, default=0)
    args = parser.parse_args()
    exit_with_parent(args.parent)

    model, device = load_model(args.model, args.device, args.compute)
    print(json.dumps({"ready": True, "model": args.model, "device": device}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        if request.get("cmd") == "shutdown":
            break
        rid = request.get("id")
        try:
            segments, info = model.transcribe(
                request["wav"],
                beam_size=int(request.get("beam") or args.beam),
                vad_filter=True,
                language=request.get("language"),
                initial_prompt=request.get("initial_prompt") or None,
            )
            text = "".join(segment.text for segment in segments).strip()
            print(json.dumps({
                "id": rid,
                "text": text,
                "language": info.language,
                "probability": round(info.language_probability, 3),
            }), flush=True)
        except Exception as exc:
            print(json.dumps({"id": rid, "error": str(exc)}), flush=True)


main()
