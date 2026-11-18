// O app desktop do Claude no Windows: onde ele guarda os dados, quais processos são dele, como fechá-lo e abri-lo, a
// chave dos logins (DPAPI) e como lançar a troca fora do Job do pacote. Medido no app 5.11492 da Microsoft Store
// (docs/planos/2026-11-18-contas-no-windows.md). Todo PowerShell daqui vai por `-EncodedCommand` (não passa pela política
// de execução, que nesta máquina bloqueia `.ps1`) e recebe dado só por variável de ambiente, nunca no texto do script.
import { execFile as execFileReal, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** O `Claude.exe` do app: o do pacote da Store ou o da instalação antiga (`AnthropicClaude\app-<versão>`). As sessões do Claude Code também se chamam `claude.exe`, então é pelo caminho, nunca pelo nome. */
export const EXE_DO_APP = String.raw`\\WindowsApps\\Claude_[^\\]+\\app\\Claude\.exe$|\\AnthropicClaude\\app-[^\\]+\\claude\.exe$`;

const PRAZO_DO_POWERSHELL_MS = 30_000;

/** Os argumentos do `powershell.exe` para rodar `script`: sem perfil, sem pergunta, codificado em UTF-16 como o `-EncodedCommand` pede. */
export const argumentosDoPowerShell = (script) => ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];

/** Roda o script e devolve `{ status, stdout }` (stdout `''` sem saída). `variaveis` entram só no ambiente do filho. */
export function rodarPowerShell(script, { variaveis = {}, executar = spawnSync, prazoMs = PRAZO_DO_POWERSHELL_MS } = {}) {
  const r = executar('powershell.exe', argumentosDoPowerShell(script), { encoding: 'utf8', windowsHide: true, timeout: prazoMs, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...variaveis } });
  return { status: r?.status ?? null, stdout: typeof r?.stdout === 'string' ? r.stdout : '' };
}

// ---- a pasta do app ----
const dentro = (dir, prefixo) => { try { return readdirSync(dir).filter((n) => n.toLowerCase().startsWith(prefixo)).sort().map((n) => join(dir, n)); } catch { return []; } };

/**
 * Onde o app pode guardar os dados, na ordem em que se procura: `%LOCALAPPDATA%\Claude-Data\claude_<pacote>` (o app da
 * Store de agora), `%APPDATA%\Claude` (a instalação antiga) e a pasta virtualizada do pacote. As duas últimas, no app
 * de agora, só têm o marcador `.user-data-left.*`: os dados mudaram para a primeira.
 */
export function pastasDoAppNoWindows(env = process.env) {
  const local = env.LOCALAPPDATA || join(env.USERPROFILE || homedir(), 'AppData', 'Local');
  const roaming = env.APPDATA || join(env.USERPROFILE || homedir(), 'AppData', 'Roaming');
  return [...dentro(join(local, 'Claude-Data'), 'claude_'), join(roaming, 'Claude'), ...dentro(join(local, 'Packages'), 'claude_').map((p) => join(p, 'LocalCache', 'Roaming', 'Claude'))];
}

/** A primeira pasta com `config.json`; sem nenhuma, a primeira candidata (a leitura dá `semConfig`, como no Mac sem o app). */
export function pastaDoAppNoWindows(env = process.env) {
  const candidatas = pastasDoAppNoWindows(env);
  return candidatas.find((d) => existsSync(join(d, 'config.json'))) ?? candidatas[0];
}

// ---- o controle do app ----
// Os processos do app são os desta sessão do Windows (com outra pessoa logada na máquina, o app dela não é tocado) cujo
// caminho é o do app. Todo script do controle começa por este filtro.
const DO_APP = `$p = '${EXE_DO_APP}'
$sessao = (Get-Process -Id $PID).SessionId
$doApp = @(Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sessao -and $_.Path -match $p })`;

/** 0: o app está aberto; 1: fechado. Qualquer outra saída (PowerShell que não sobe, prazo estourado) é "não sei". */
export const RODANDO = `${DO_APP}
if ($doApp.Count) { exit 0 } else { exit 1 }`;

/** O C# que manda o recado de fim de sessão às janelas de um processo (todas as de nível de cima, inclusive as escondidas na bandeja). */
export const CODIGO_DO_FECHAR = `using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class FecharOClaude {
  delegate bool Visita(IntPtr janela, IntPtr nada);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visita v, IntPtr nada);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr janela, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr janela, uint msg, IntPtr w, IntPtr l, uint modo, uint prazo, out IntPtr r);
  public static int Fechar(uint pid) {
    var janelas = new List<IntPtr>();
    EnumWindows(delegate(IntPtr j, IntPtr n) { uint dono; GetWindowThreadProcessId(j, out dono); if (dono == pid) janelas.Add(j); return true; }, IntPtr.Zero);
    IntPtr r;
    foreach (var j in janelas) SendMessageTimeout(j, 0x11, IntPtr.Zero, (IntPtr)1, 2, 5000, out r);
    foreach (var j in janelas) SendMessageTimeout(j, 0x16, (IntPtr)1, (IntPtr)1, 2, 5000, out r);
    return janelas.Count;
  }
}`;

// Fechar a janela só esconde o app na bandeja. O app sai limpo (app.quit) no fim de sessão do Windows: é o recado que o
// Windows manda a um app que precisa fechar (WM_QUERYENDSESSION e WM_ENDSESSION com ENDSESSION_CLOSEAPP, o mesmo do
// Restart Manager), mandado só às janelas do processo principal do app (o que não é filho de outro processo do app).
// Sai com 2 se o C# não compilou (PowerShell restrito): quem chama registra e cai no fechamento à força.
export const FECHAR = `${DO_APP}
$ids = @($doApp | ForEach-Object { $_.Id })
$principais = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $ids -contains $_.ProcessId -and $ids -notcontains $_.ParentProcessId })
if (-not $principais.Count) { exit 0 }
try { Add-Type -TypeDefinition @'
${CODIGO_DO_FECHAR}
'@ -ErrorAction Stop } catch { exit 2 }
foreach ($q in $principais) { [void][FecharOClaude]::Fechar([uint32]$q.ProcessId) }
exit 0`;

// Só os processos do app, sem árvore: a troca (que pode descender do app) e as sessões do Code não morrem por aqui.
export const MATAR = `${DO_APP}
$doApp | Stop-Process -Force -ErrorAction SilentlyContinue
exit 0`;

export const ABRIR = `$pk = Get-AppxPackage -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.PackageFamilyName -like 'Claude_*' } | Select-Object -First 1
if ($pk) {
  $id = (Get-AppxPackageManifest $pk).Package.Applications.Application | Where-Object { $_.Executable -eq 'app\\Claude.exe' } | Select-Object -First 1 -ExpandProperty Id
  if (-not $id) { $id = 'Claude' }
  Start-Process ('shell:AppsFolder\\' + $pk.PackageFamilyName + '!' + $id)
  exit 0
}
$exe = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\\claude.exe'
if (Test-Path $exe) { Start-Process $exe; exit 0 }
exit 1`;

const NAO_SEI = 'não consegui saber se o Claude está aberto (o PowerShell não respondeu)';

/**
 * O controle do app no Windows, com a forma do do Mac ({ rodando, fechar, abrir }). `executar` e `dormir` entram nos
 * testes; `log` recebe o que a troca deve saber (o recado que não foi, o fechamento à força).
 * "Não sei se está aberto" nunca vale como fechado: seria gravar o login com o app aberto (o incidente de 13/11, no Mac).
 * Antes do recado, recusa e nada muda. Depois dele, uma leitura sem resposta é tentada de novo até o prazo; se o prazo
 * acaba sem saber, tenta abrir o app (o que não abre um segundo, se ele ainda está aberto) e lança.
 */
export function controleDoWindows({ esperaFechar = 20_000, esperaMatar = 10_000, executar = spawnSync, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  const rodar = (script) => rodarPowerShell(script, { executar });
  /** true, false ou null (não sei). */
  const ler = () => { const s = rodar(RODANDO).status; return s === 0 ? true : s === 1 ? false : null; };
  const rodando = () => { const v = ler(); if (v === null) throw new Error(NAO_SEI); return v; };
  const esperarSair = async (limite) => {
    let soube = false;
    for (const fim = Date.now() + limite; Date.now() < fim; await dormir(300)) {
      const v = ler();
      if (v !== null) soube = true;
      if (v === false) { await dormir(700); return true; }
    }
    return soube ? false : null;
  };
  const desistir = (motivo) => {
    rodar(ABRIR);
    throw new Error(motivo);
  };
  return {
    rodando: async () => rodando(),
    async fechar() {
      if (!rodando()) return;
      const recado = rodar(FECHAR).status;
      if (recado !== 0) log(recado === 2 ? 'o PowerShell não compilou o recado de fechar; o app vai ser fechado à força' : 'o recado de fechar não foi; o app vai ser fechado à força');
      const saiu = recado === 0 ? await esperarSair(esperaFechar) : false;
      if (saiu) return;
      if (saiu === null) desistir(NAO_SEI);
      log(`o Claude não saiu em ${Math.round(esperaFechar / 1000)} s; fechando à força só os processos do app`);
      rodar(MATAR);
      const morreu = await esperarSair(esperaMatar);
      if (morreu) return;
      desistir(morreu === null ? NAO_SEI : 'o Claude não fechou');
    },
    async abrir() {
      if (rodar(ABRIR).status !== 0) throw new Error('não consegui abrir o Claude');
    },
  };
}

// ---- a chave dos logins ----
const ABRIR_A_CHAVE = `Add-Type -AssemblyName System.Security
$b = [Convert]::FromBase64String($env:CONTAS_CHAVE_CIFRADA)
[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')))`;

const TAMANHO_DA_CHAVE = 32;
const negada = (motivo) => Object.assign(new Error('negada'), { motivo });
// Sem o PowerShell (`semSecurity`, o nome do Mac para "sem o programa que lê a chave"), prazo estourado (`semResposta`), o resto é recusa (`negou`).
const motivoDaRecusa = (erro) => (erro?.code === 'ENOENT' ? 'semSecurity' : erro?.killed || erro?.signal || erro?.code === 'ETIMEDOUT' ? 'semResposta' : 'negou');

/**
 * A chave AES-256 com que o app cifra os logins: `os_crypt.encrypted_key` do `Local State` (prefixo `DPAPI`), aberta pela
 * DPAPI da conta do Windows. Não pede nada à pessoa. O blob vai ao PowerShell pelo ambiente do filho; a chave volta pela
 * saída dele e só fica na memória. Recusa sem repassar mensagem de erro.
 */
export function lerChaveDoWindows({ dir = pastaDoAppNoWindows(), execFile = execFileReal } = {}) {
  return new Promise((resolve, reject) => {
    let blob;
    try {
      const bruto = Buffer.from(JSON.parse(readFileSync(join(dir, 'Local State'), 'utf8'))?.os_crypt?.encrypted_key ?? '', 'base64');
      if (bruto.length <= 5 || bruto.subarray(0, 5).toString('latin1') !== 'DPAPI') throw new Error();
      blob = bruto.subarray(5).toString('base64');
    } catch { reject(negada('negou')); return; }
    try {
      execFile('powershell.exe', argumentosDoPowerShell(ABRIR_A_CHAVE), { encoding: 'utf8', windowsHide: true, timeout: PRAZO_DO_POWERSHELL_MS, killSignal: 'SIGKILL', env: { ...process.env, CONTAS_CHAVE_CIFRADA: blob } }, (erro, saida) => {
        if (erro || typeof saida !== 'string') { reject(negada(motivoDaRecusa(erro))); return; }
        const chave = Buffer.from(saida.trim(), 'base64');
        if (chave.length !== TAMANHO_DA_CHAVE) { chave.fill(0); reject(negada('negou')); return; }
        resolve(chave);
      });
    } catch { reject(negada('negou')); }
  });
}

// ---- processos ----
/** A linha de comando de um processo (`Win32_Process.CommandLine`); vazio se não der para ler. */
export function comandoDoPidNoWindows(pid, { executar = spawnSync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const r = rodarPowerShell("(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:CONTAS_PID)).CommandLine", { variaveis: { CONTAS_PID: String(pid) }, executar, prazoMs: 10_000 });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** Pids que escutam na porta, lidos da saída de `netstat -ano -p TCP`; só linhas LISTENING do endereço local. */
export function pidsEscutandoNaPorta(saida, porta) {
  const alvos = [`127.0.0.1:${porta}`, `0.0.0.0:${porta}`, `[::1]:${porta}`, `[::]:${porta}`];
  const pids = new Set();
  for (const linha of String(saida ?? '').split(/\r?\n/)) {
    const c = linha.trim().split(/\s+/);
    if (c.length < 5 || c[0].toUpperCase() !== 'TCP' || c[3].toUpperCase() !== 'LISTENING' || !alvos.includes(c[1])) continue;
    const pid = Number(c[4]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

// ---- lançar fora do Job do pacote ----
/**
 * Tudo que o app lança (as sessões do Code, o painel, o filho que o painel solta) mora no Job do pacote da Store, e nada
 * de antes do app reabrir continua vivo depois: a troca, que fecha o app, morreria no meio com ele fechado. O processo
 * criado pelo WMI (`Win32_Process.Create`) nasce fora de qualquer Job (medido). Ele não herda o ambiente: o pedido
 * (`pedido`, um arquivo que `solto.mjs` lê e apaga) leva só as variáveis de `VARIAVEIS_DO_SOLTO` e o arquivo de log.
 */
// Só caminhos e chaves de configuração, nunca o ambiente inteiro (que pode ter segredo e iria a disco no pedido). As pastas
// do perfil entram porque a pasta de dados e a do app saem delas.
export const VARIAVEIS_DO_SOLTO = ['CLAUDE_APP_DIR', 'TROCA_DE_CONTA_DIR', 'CLAUDE_CONFIG_DIR', 'ICHIKAWA_HOME', 'PAINEL_DE_CONTAS_PORTA', 'TROCA_SEM_CLONE', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'];

// `ShowWindow = 0` (SW_HIDE): sem ele o node nasce num console visível, e fechar essa janela mataria a troca no meio.
const CRIAR = `$inicio = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:CONTAS_LINHA; CurrentDirectory = $env:CONTAS_PASTA; ProcessStartupInformation = $inicio }
if ($r.ReturnValue -ne 0) { exit 1 }
[Console]::Out.Write([string]$r.ProcessId)`;

/**
 * A linha de comando do Windows para `args` (cada um entre aspas). Aspa dentro de um argumento, ou `\` no fim (que
 * escaparia a aspa de fechar), recusa: não há como passá-los sem ambiguidade.
 */
export function linhaDeComando(args) {
  if (args.some((a) => typeof a !== 'string' || a.includes('"') || a.endsWith('\\'))) throw new Error('argumento com aspas ou barra no fim');
  return args.map((a) => `"${a}"`).join(' ');
}

/** O caminho de `solto.mjs` como URL, para o `--import`. */
export const PRELOAD_DO_SOLTO = pathToFileURL(fileURLToPath(new URL('./solto.mjs', import.meta.url))).href;

/**
 * Lança `node --import solto.mjs <script> --pedido-solto <pedido> <args…>` pelo WMI e devolve o pid. O script roda como
 * programa (a linha de comando dele é a de sempre, que o painel reconhece); `solto.mjs` tira o `--pedido-solto` do argv antes.
 */
export function soltarPeloWmi({ script, args = [], pedido, pasta, executar = spawnSync }) {
  const linha = linhaDeComando([process.execPath, '--import', PRELOAD_DO_SOLTO, script, '--pedido-solto', pedido, ...args]);
  const r = rodarPowerShell(CRIAR, { variaveis: { CONTAS_LINHA: linha, CONTAS_PASTA: pasta }, executar });
  const pid = Number(r.stdout.trim());
  if (r.status !== 0 || !Number.isInteger(pid) || pid <= 0) throw new Error('não consegui lançar o processo pelo WMI');
  return pid;
}
