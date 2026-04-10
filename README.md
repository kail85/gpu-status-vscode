# GPU Status

Shows GPU VRAM usage in the VS Code / Cursor status bar.

**Example:** `NVIDIA RTX 500 Ada GPU: 10 MiB / 4094 MiB`

Click the status bar item to switch between GPUs when multiple are detected.

## Requirements

One of:
- **NVIDIA GPU** — `nvidia-smi` must be on PATH (installed with NVIDIA drivers)
- **AMD GPU on Linux** — `rocm-smi` must be on PATH (installed with ROCm)

> macOS Apple Silicon unified memory is not supported.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `gpuStatus.pollInterval` | `2000` | Refresh interval in milliseconds (min 500) |

## Commands

- **GPU Status: Select GPU to Display** — choose which GPU appears in the status bar (when multiple GPUs are present)
