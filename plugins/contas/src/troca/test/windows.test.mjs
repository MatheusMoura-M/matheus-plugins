import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pastaDoApp } from '../app-do-claude.mjs';
import { ABRIR, CODIGO_DO_FECHAR, EXE_DO_APP, FECHAR, MATAR, RODANDO, argumentosDoPowerShell, controleDoWindows, rodarPowerShell, lerChaveDoWindows, linhaDeComando, pastaDoAppNoWindows, pastasDoAppNoWindows, pidsEscutandoNaPorta } from '../windows.mjs';

const scriptDe = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
const pastaVazia = () => mkdtempSync(join(tmpdir(), 'contas-windows-'));

describe('windows: a pasta do app', () => {
  it('a do Claude-Data com config.json vence; sem nenhuma, a primeira candidata; CLAUDE_APP_DIR vale acima de tudo', () => {
    const raiz = pastaVazia();
    const env = { LOCALAPPDATA: join(raiz, 'Local'), APPDATA: join(raiz, 'Roaming') };
    const dados = join(env.LOCALAPPDATA, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
    const antiga = join(env.APPDATA, 'Claude');
    const virtual = join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
    for (const d of [dados, antiga, virtual]) mkdirSync(d, { recursive: true });
    assert.deepEqual(pastasDoAppNoWindows(env), [dados, antiga, virtual]);
    assert.equal(pastaDoAppNoWindows(env), dados, 'sem config.json em nenhuma: a primeira');
    writeFileSync(join(antiga, 'config.json'), '{}');
    assert.equal(pastaDoAppNoWindows(env), antiga, 'só a antiga tem config.json (a instalação de antes)');
    writeFileSync(join(dados, 'config.json'), '{}');
    assert.equal(pastaDoAppNoWindows(env), dados);
    assert.equal(pastaDoApp(env, 'win32'), dados);
    assert.equal(pastaDoApp({ ...env, CLAUDE_APP_DIR: 'X:\\outra' }, 'win32'), 'X:\\outra');
  });

  it('sem Claude-Data nem pacote, a candidata é o %APPDATA%\\Claude', () => {
    const raiz = pastaVazia();
    const env = { LOCALAPPDATA: join(raiz, 'Local'), APPDATA: join(raiz, 'Roaming') };
    assert.equal(pastaDoAppNoWindows(env), join(env.APPDATA, 'Claude'));
  });
});

describe('windows: quais processos são do app', () => {
  const ehDoApp = (caminho) => new RegExp(EXE_DO_APP, 'i').test(caminho);
  it('o Claude.exe do pacote e o da instalação antiga; nunca o claude.exe do Claude Code', () => {
    assert.ok(ehDoApp('C:\\Program Files\\WindowsApps\\Claude_5.11492.5.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe'));
    assert.ok(ehDoApp('C:\\Users\\x\\AppData\\Local\\AnthropicClaude\\app-0.9.3\\claude.exe'));
    assert.ok(!ehDoApp('C:\\Users\\x\\AppData\\Local\\Claude-Data\\claude_pzs8sxrjxfjjc\\claude-code\\2.1.325\\806e0a45e6f5\\claude.exe'));
    assert.ok(!ehDoApp('C:\\Users\\x\\.local\\bin\\claude.exe'));
    assert.ok(!ehDoApp('C:\\Program Files\\WindowsApps\\Claude_5.11492.5.0_x64__pzs8sxrjxfjjc\\app\\resources\\claude-ssh-proxy.exe'));
  });
});

describe('windows: o controle do app', () => {
  // Simula o Windows: o app roda até o recado de fim de sessão (ou o Stop-Process, se `teimoso`). Cada script é
  // reconhecido por inteiro (igual ao exportado), não por um pedaço do texto. `semResposta(i)` diz se a i-ésima leitura
  // do "rodando" fica sem resposta do PowerShell (status null).
  const simular = ({ teimoso = false, abreNao = false, recado = 0, semResposta = () => false } = {}) => {
    const acoes = [];
    const logs = [];
    let vivo = true;
    let leituras = 0;
    const executar = (cmd, args, opcoes) => {
      assert.equal(cmd, 'powershell.exe');
      assert.equal(opcoes.windowsHide, true);
      const s = scriptDe(args);
      if (s === FECHAR) { acoes.push('fechar'); if (!teimoso && recado === 0) vivo = false; return { status: recado }; }
      if (s === MATAR) { acoes.push('matar'); vivo = false; return { status: 0 }; }
      if (s === ABRIR) { acoes.push('abrir'); return { status: abreNao ? 1 : 0 }; }
      if (s === RODANDO) { acoes.push('rodando'); return { status: semResposta(leituras++) ? null : vivo ? 0 : 1 }; }
      throw new Error(`script inesperado: ${s.slice(0, 80)}`);
    };
    return { acoes, logs, controle: controleDoWindows({ executar, dormir: async () => {}, esperaFechar: 50, esperaMatar: 50, log: (t) => logs.push(t) }) };
  };

  it('fecha pelo recado de fim de sessão, sem matar nada, e abre pelo pacote', async () => {
    const { acoes, controle } = simular();
    assert.equal(await controle.rodando(), true);
    await controle.fechar();
    assert.ok(acoes.includes('fechar'));
    assert.ok(!acoes.includes('matar'), acoes.join(' '));
    assert.equal(await controle.rodando(), false);
    await controle.abrir();
    assert.equal(acoes.at(-1), 'abrir');
  });

  it('o app que não sai pelo recado é morto à força, só pelos processos do app', async () => {
    const { acoes, controle } = simular({ teimoso: true });
    await controle.fechar();
    assert.ok(acoes.indexOf('matar') > acoes.indexOf('fechar'), acoes.join(' '));
  });

  it('o app fechado não recebe recado; o que não abre vira erro', async () => {
    const { acoes, controle } = simular({ abreNao: true });
    await controle.fechar();
    acoes.length = 0;
    await controle.fechar();
    assert.deepEqual(acoes, ['rodando']);
    await assert.rejects(controle.abrir(), /não consegui abrir o Claude/);
  });

  it('o app que não sai pelo recado é morto à força, e isso vai ao log; recado que não compila também', async () => {
    const teimoso = simular({ teimoso: true });
    await teimoso.controle.fechar();
    assert.match(teimoso.logs.join(' | '), /fechando à força só os processos do app/);
    const restrito = simular({ recado: 2 });
    await restrito.controle.fechar();
    assert.deepEqual(restrito.acoes.filter((a) => a !== 'rodando'), ['fechar', 'matar'], 'sem recado, não espera os 20 s: vai direto ao fechamento à força');
    assert.match(restrito.logs[0], /não compilou/);
  });

  it('"não sei se está aberto" nunca vale como fechado: antes do recado recusa sem mexer em nada', async () => {
    const { acoes, controle } = simular({ semResposta: (i) => i === 0 });
    await assert.rejects(controle.fechar(), /não consegui saber se o Claude está aberto/);
    assert.deepEqual(acoes, ['rodando'], 'nem recado, nem fechamento à força');
    await assert.rejects(simular({ semResposta: () => true }).controle.rodando(), /não consegui saber/);
  });

  it('depois do recado, a leitura sem resposta é tentada de novo; o prazo todo sem resposta tenta abrir o app e recusa', async () => {
    const umaFalha = simular({ semResposta: (i) => i === 1 });
    await umaFalha.controle.fechar();
    assert.ok(!umaFalha.acoes.includes('matar'), 'uma leitura sem resposta no meio não muda nada');
    const sempre = simular({ teimoso: true, semResposta: (i) => i > 0 });
    await assert.rejects(sempre.controle.fechar(), /não consegui saber/);
    assert.ok(!sempre.acoes.includes('matar'), 'sem saber, não mata');
    assert.equal(sempre.acoes.at(-1), 'abrir', 'e tenta deixar o app aberto');
  });

  it('os scripts: todos filtram pelo caminho do app e pela sessão do Windows; matar não pega árvore nem nome solto; fechar só o processo principal', () => {
    const doApp = "Where-Object { $_.SessionId -eq $sessao -and $_.Path -match $p }";
    for (const [nome, s] of Object.entries({ RODANDO, FECHAR, MATAR })) {
      assert.ok(s.includes(`$p = '${EXE_DO_APP}'`), `${nome}: o caminho do app`);
      assert.ok(s.includes(doApp), `${nome}: o filtro do app`);
      assert.doesNotMatch(s, /taskkill|\/T\b|Stop-Process -Name|IncludeChildren/i, `${nome}: nada de árvore nem nome solto`);
    }
    assert.match(MATAR, /^\$doApp \| Stop-Process -Force/m, 'MATAR só encerra a lista filtrada');
    assert.equal((MATAR.match(/Stop-Process/g) ?? []).length, 1);
    assert.ok(FECHAR.includes('$ids -contains $_.ProcessId -and $ids -notcontains $_.ParentProcessId'), 'FECHAR: só o principal dos processos do app');
    assert.ok(!FECHAR.includes('Stop-Process'), 'FECHAR não mata nada');
    assert.ok(FECHAR.includes(CODIGO_DO_FECHAR));
    assert.match(CODIGO_DO_FECHAR, /0x11[\s\S]*0x16/, 'WM_QUERYENDSESSION antes de WM_ENDSESSION');
    assert.ok(argumentosDoPowerShell('x').includes('-NonInteractive'));
  });

  it('no Windows de verdade: o C# do recado compila e o "rodando" não casa com o claude.exe do Claude Code', (t) => {
    if (process.platform !== 'win32') { t.skip('só no Windows'); return; }
    const compila = rodarPowerShell(`Add-Type -TypeDefinition @'\n${CODIGO_DO_FECHAR}\n'@ -ErrorAction Stop\n[Console]::Out.Write([FecharOClaude].Name)`, { prazoMs: 60_000 });
    assert.equal(compila.stdout, 'FecharOClaude', 'o C# não compilou');
    const vistos = rodarPowerShell(`${RODANDO.split('\n').slice(0, -1).join('\n')}\n[Console]::Out.Write(($doApp | ForEach-Object { $_.Path }) -join '|')`, { prazoMs: 60_000 });
    for (const caminho of vistos.stdout.split('|').filter(Boolean)) assert.match(caminho, /\\app(-[^\\]+)?\\claude\.exe$/i, `o filtro pegou ${caminho}`);
    const doCode = rodarPowerShell("[Console]::Out.Write((Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\\claude-code\\*' } | ForEach-Object { $_.Path }) -join '|')", { prazoMs: 60_000 });
    for (const caminho of doCode.stdout.split('|').filter(Boolean)) assert.ok(!new RegExp(EXE_DO_APP, 'i').test(caminho), `o filtro do app pegaria a sessão do Code ${caminho}`);
  });
});

describe('windows: a chave dos logins', () => {
  const pastaComChave = (valor) => {
    const dir = pastaVazia();
    writeFileSync(join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: valor } }));
    return dir;
  };
  const blob = Buffer.concat([Buffer.from('DPAPI'), Buffer.from('cifrado')]).toString('base64');

  it('tira o DPAPI, manda o resto pelo ambiente do filho (nunca no script) e devolve os 32 bytes', async () => {
    const chave = Buffer.alloc(32, 7);
    let visto;
    const execFile = (cmd, args, opcoes, cb) => { visto = { cmd, script: scriptDe(args), opcoes }; cb(null, `${chave.toString('base64')}\r\n`); };
    const r = await lerChaveDoWindows({ dir: pastaComChave(blob), execFile });
    assert.deepEqual(r, chave);
    assert.equal(visto.cmd, 'powershell.exe');
    assert.equal(visto.opcoes.env.CONTAS_CHAVE_CIFRADA, Buffer.from('cifrado').toString('base64'));
    assert.ok(!visto.script.includes(visto.opcoes.env.CONTAS_CHAVE_CIFRADA));
    assert.match(visto.script, /ProtectedData\]::Unprotect/);
  });

  it('recusa sem repassar a mensagem: Local State torto, sem o prefixo, saída curta, PowerShell ausente ou lento', async () => {
    const nunca = () => { throw new Error('não devia chamar o PowerShell'); };
    await assert.rejects(lerChaveDoWindows({ dir: pastaVazia(), execFile: nunca }), (e) => e.motivo === 'negou' && e.message === 'negada');
    await assert.rejects(lerChaveDoWindows({ dir: pastaComChave(Buffer.from('v10xyz').toString('base64')), execFile: nunca }), (e) => e.motivo === 'negou');
    const com = (erro, saida) => (cmd, args, opcoes, cb) => cb(erro, saida);
    await assert.rejects(lerChaveDoWindows({ dir: pastaComChave(blob), execFile: com(null, Buffer.alloc(16).toString('base64')) }), (e) => e.motivo === 'negou');
    await assert.rejects(lerChaveDoWindows({ dir: pastaComChave(blob), execFile: com(Object.assign(new Error('x segredo'), { code: 'ENOENT' })) }), (e) => e.motivo === 'semSecurity' && !e.message.includes('segredo'));
    await assert.rejects(lerChaveDoWindows({ dir: pastaComChave(blob), execFile: com(Object.assign(new Error('x'), { killed: true })) }), (e) => e.motivo === 'semResposta');
  });
});

describe('windows: processos e linha de comando', () => {
  it('pidsEscutandoNaPorta lê só LISTENING do endereço local, sem repetir', () => {
    const saida = [
      '  Proto  Endereço local         Endereço externo       Estado         PID',
      '  TCP    127.0.0.1:4791         0.0.0.0:0              LISTENING      111',
      '  TCP    [::1]:4791             [::]:0                 LISTENING      111',
      '  TCP    127.0.0.1:4791         127.0.0.1:50000        ESTABLISHED    222',
      '  TCP    127.0.0.1:47910        0.0.0.0:0              LISTENING      333',
      '  TCP    0.0.0.0:4791           0.0.0.0:0              LISTENING      444',
    ].join('\r\n');
    assert.deepEqual(pidsEscutandoNaPorta(saida, 4791), [111, 444]);
    assert.deepEqual(pidsEscutandoNaPorta('', 4791), []);
  });

  it('linhaDeComando põe cada argumento entre aspas e recusa aspas dentro', () => {
    assert.equal(linhaDeComando(['C:\\Program Files\\nodejs\\node.exe', 'C:\\x y\\cli.mjs', 'adicionar']), '"C:\\Program Files\\nodejs\\node.exe" "C:\\x y\\cli.mjs" "adicionar"');
    assert.throws(() => linhaDeComando(['a"b']), /aspas/);
    assert.throws(() => linhaDeComando([7]), /aspas/);
    assert.throws(() => linhaDeComando(['C:\\x\\']), /barra no fim/, 'a barra no fim escaparia a aspa de fechar');
  });
});
