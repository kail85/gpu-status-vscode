import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface GpuInfo {
  index: number;
  name: string;
  usedMiB: number;
  totalMiB: number;
}

// nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader,nounits
// Output example: "0, NVIDIA GeForce RTX 3080, 1024, 10240"
async function queryNvidiaSmi(): Promise<GpuInfo[]> {
  const { stdout } = await execAsync(
    'nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader,nounits',
    { timeout: 5000 }
  );
  return stdout
    .trim()
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      const parts = line.split(',');
      if (parts.length < 4) return null;
      // Slice robustly: index is first, last two are numerics, name is everything in between
      const index = parseInt(parts[0].trim(), 10);
      const totalMiB = parseInt(parts[parts.length - 1].trim(), 10);
      const usedMiB = parseInt(parts[parts.length - 2].trim(), 10);
      const name = parts.slice(1, parts.length - 2).join(',').trim();
      if (isNaN(index) || isNaN(usedMiB) || isNaN(totalMiB)) return null;
      return { index, name, usedMiB, totalMiB };
    })
    .filter((g): g is GpuInfo => g !== null);
}

// rocm-smi --showmeminfo vram --json  (AMD GPUs on Linux)
async function queryRocmSmi(): Promise<GpuInfo[]> {
  const { stdout } = await execAsync('rocm-smi --showmeminfo vram --json', { timeout: 5000 });
  const data: Record<string, Record<string, string>> = JSON.parse(stdout);
  const gpus: GpuInfo[] = [];
  let index = 0;
  for (const [key, val] of Object.entries(data)) {
    if (key.toLowerCase().startsWith('card')) {
      const usedBytes = parseInt(val['VRAM Total Used Memory (B)'] ?? '0', 10);
      const totalBytes = parseInt(val['VRAM Total Memory (B)'] ?? '0', 10);
      gpus.push({
        index,
        name: `AMD GPU (${key})`,
        usedMiB: Math.round(usedBytes / 1_048_576),
        totalMiB: Math.round(totalBytes / 1_048_576),
      });
      index++;
    }
  }
  return gpus;
}

async function detectGpus(): Promise<GpuInfo[]> {
  try {
    const gpus = await queryNvidiaSmi();
    if (gpus.length > 0) return gpus;
  } catch {
    // nvidia-smi not found or no NVIDIA GPUs present
  }
  try {
    const gpus = await queryRocmSmi();
    if (gpus.length > 0) return gpus;
  } catch {
    // rocm-smi not found or no AMD GPUs present
  }
  return [];
}

function formatStatusText(gpu: GpuInfo): string {
  return `$(circuit-board) ${gpu.name}: ${gpu.usedMiB} MiB / ${gpu.totalMiB} MiB`;
}

function formatTooltip(gpu: GpuInfo, totalGpus: number): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${gpu.name}**\n\n`);
  md.appendMarkdown(`VRAM: ${gpu.usedMiB} MiB / ${gpu.totalMiB} MiB\n\n`);
  if (totalGpus > 1) {
    md.appendMarkdown(`*Click to switch GPU (${totalGpus} GPUs detected)*`);
  }
  return md;
}

export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'gpuStatus.selectGpu';
  statusBarItem.text = '$(circuit-board) GPU: Loading\u2026';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  let selectedGpuIndex = 0;
  let cachedGpus: GpuInfo[] = [];

  async function updateStatus(): Promise<void> {
    try {
      const gpus = await detectGpus();
      cachedGpus = gpus;

      if (gpus.length === 0) {
        statusBarItem.text = '$(circuit-board) No GPU';
        statusBarItem.tooltip = 'No GPU detected. Ensure nvidia-smi or rocm-smi is on PATH.';
        return;
      }

      if (selectedGpuIndex >= gpus.length) {
        selectedGpuIndex = 0;
      }

      const gpu = gpus[selectedGpuIndex];
      statusBarItem.text = formatStatusText(gpu);
      statusBarItem.tooltip = formatTooltip(gpu, gpus.length);
    } catch (err) {
      statusBarItem.text = '$(circuit-board) GPU: Error';
      statusBarItem.tooltip = `Error querying GPU stats: ${String(err)}`;
    }
  }

  async function selectGpu(): Promise<void> {
    if (cachedGpus.length === 0) {
      vscode.window.showWarningMessage('No GPUs detected. Ensure nvidia-smi or rocm-smi is on PATH.');
      return;
    }
    if (cachedGpus.length === 1) {
      const gpu = cachedGpus[0];
      vscode.window.showInformationMessage(
        `${gpu.name}: ${gpu.usedMiB} MiB / ${gpu.totalMiB} MiB (only one GPU detected)`
      );
      return;
    }

    const items = cachedGpus.map(gpu => ({
      label: gpu.name,
      description: `${gpu.usedMiB} MiB / ${gpu.totalMiB} MiB`,
      detail: `GPU index: ${gpu.index}`,
      gpuIndex: gpu.index,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select GPU to display in status bar',
    });

    if (picked) {
      selectedGpuIndex = picked.gpuIndex;
      await updateStatus();
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('gpuStatus.selectGpu', selectGpu)
  );

  updateStatus();

  const config = vscode.workspace.getConfiguration('gpuStatus');
  let pollInterval = Math.max(500, config.get<number>('pollInterval', 2000));
  let timer = setInterval(updateStatus, pollInterval);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gpuStatus.pollInterval')) {
        clearInterval(timer);
        pollInterval = Math.max(
          500,
          vscode.workspace.getConfiguration('gpuStatus').get<number>('pollInterval', 2000)
        );
        timer = setInterval(updateStatus, pollInterval);
      }
    }),
    { dispose: () => clearInterval(timer) }
  );
}

export function deactivate(): void {}
